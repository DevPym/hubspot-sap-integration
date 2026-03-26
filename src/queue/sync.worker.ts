/**
 * sync.worker.ts — Worker BullMQ que procesa jobs de sincronización.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Escuchar la cola 'hubspot-sap-sync' en Redis                      │
 * │  2. Procesar cada job llamando syncHubSpotToSap()                     │
 * │  3. Registrar jobs fallidos en retry_job (PostgreSQL)                  │
 * │  4. Marcar como exhausted cuando se agotan los reintentos              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - src/services/sync.service.ts → syncHubSpotToSap()                │
 * │    - src/db/repositories/retryjob.repository.ts → persistir fallos    │
 * │    - src/config/env.ts → REDIS_URL, MAX_RETRY_ATTEMPTS                │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/index.ts → se inicia al arrancar el servidor                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLUJO DE UN JOB                                                        │
 * │  ────────────────                                                       │
 * │  1. Worker toma job de Redis                                            │
 * │  2. Extrae HubSpotSyncEvent del job.data                              │
 * │  3. Llama syncHubSpotToSap(event)                                     │
 * │  4a. Éxito → log + job se marca como completed                        │
 * │  4b. Error → BullMQ reintenta con backoff exponencial                 │
 * │  5. Si se agotan reintentos → failed event → guardar en retry_job     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAME } from './sync.queue';
import {
  syncHubSpotToSap,
  MissingDependencyError,
  type HubSpotSyncEvent,
  type SyncResult,
} from '../services/sync.service';
import { retryJobRepo } from '../db/repositories/retryjob.repository';
import { env } from '../config/env';

// ---------------------------------------------------------------------------
// Conexión Redis (misma que la cola)
// ---------------------------------------------------------------------------

function parseRedisUrl(url: string): { host: string; port: number; password?: string; username?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 6379,
    password: parsed.password || undefined,
    username: parsed.username !== 'default' ? parsed.username : undefined,
  };
}

// ---------------------------------------------------------------------------
// Processor — función que procesa cada job
// ---------------------------------------------------------------------------

/**
 * Procesa un job de sincronización.
 * Esta función es llamada por BullMQ para cada job en la cola.
 *
 * Si lanza un error, BullMQ reintenta automáticamente según la configuración
 * de backoff exponencial definida en sync.queue.ts.
 */
async function processJob(job: Job<HubSpotSyncEvent>): Promise<SyncResult> {
  const event = job.data;
  const attempt = job.attemptsMade + 1;

  console.log(
    `[worker] Procesando job ${job.id} (intento ${attempt}/${env.MAX_RETRY_ATTEMPTS}): ` +
    `${event.entityType} ${event.objectId} [${event.subscriptionType}]`,
  );

  const result = await syncHubSpotToSap(event);

  if (result.success) {
    console.log(
      `[worker] ✅ Job ${job.id} completado: ${result.operation} ` +
      `${result.entityType} HS:${result.hubspotId} → SAP:${result.sapId || 'N/A'}`,
    );
  } else if (result.operation === 'SKIPPED') {
    console.log(
      `[worker] ⏭️ Job ${job.id} saltado: ${result.reason}`,
    );
  } else {
    // sync.service retornó error pero no lanzó excepción
    // Lanzamos para que BullMQ reintente
    throw new Error(result.error || `Sync falló: ${result.reason}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Instancia del Worker
// ---------------------------------------------------------------------------

let workerInstance: Worker<HubSpotSyncEvent, SyncResult> | null = null;

/**
 * Crea e inicia el worker de sincronización.
 *
 * Concurrency = 1: procesa un job a la vez para evitar:
 * - Múltiples CSRF tokens simultáneos en SAP
 * - Condiciones de carrera en id_map
 * - Exceso de rate limit en HubSpot
 */
export function createSyncWorker(): Worker<HubSpotSyncEvent, SyncResult> {
  if (workerInstance) {
    return workerInstance;
  }

  const connection = parseRedisUrl(env.REDIS_URL);

  workerInstance = new Worker<HubSpotSyncEvent, SyncResult>(
    QUEUE_NAME,
    processJob,
    {
      connection,
      concurrency: 1, // Un job a la vez — seguridad para SAP
      limiter: {
        max: 10,       // Máximo 10 jobs por ventana
        duration: 60000, // Ventana de 1 minuto (10 jobs/min)
      },
    },
  );

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  workerInstance.on('completed', (job) => {
    if (job) {
      console.log(`[worker] Job ${job.id} completed successfully`);
    }
  });

  workerInstance.on('failed', async (job, error) => {
    if (!job) return;

    const isLastAttempt = job.attemptsMade >= env.MAX_RETRY_ATTEMPTS;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Fix B1: Logging diferenciado para errores de dependencia faltante
    // Estos errores son esperados — la Company puede tardar en sincronizarse.
    const isMissingDependency = error instanceof MissingDependencyError ||
      errorMessage.includes('no encontrada en id_map');

    if (isMissingDependency && !isLastAttempt) {
      console.log(
        `[worker] ⏳ Job ${job.id} esperando dependencia (intento ${job.attemptsMade}/${env.MAX_RETRY_ATTEMPTS}): ` +
        `${job.data.entityType} ${job.data.objectId} — Company aún no sincronizada`,
      );
    } else {
      console.error(
        `[worker] ❌ Job ${job.id} failed (intento ${job.attemptsMade}/${env.MAX_RETRY_ATTEMPTS}): ${errorMessage}`,
      );
    }

    try {
      const existing = await retryJobRepo.findByBullmqJobId(job.id!);

      if (!existing) {
        // Primera falla — crear registro
        const nextRetry = new Date(Date.now() + Math.pow(2, job.attemptsMade) * 1000);
        await retryJobRepo.create({
          bullmqJobId: job.id!,
          payload: job.data as object,
          maxAttempts: env.MAX_RETRY_ATTEMPTS,
          nextRetryAt: nextRetry,
        });
      } else if (isLastAttempt) {
        // Último intento — marcar como exhausted
        await retryJobRepo.markExhausted(job.id!, errorMessage);
        console.error(`[worker] 💀 Job ${job.id} exhausted — no más reintentos`);
      } else {
        // Reintento intermedio — actualizar registro
        const nextRetry = new Date(Date.now() + Math.pow(2, job.attemptsMade) * 1000);
        await retryJobRepo.updateAttempt(job.id!, errorMessage, nextRetry);
      }
    } catch (dbError) {
      // Si falla el registro en PostgreSQL, solo loguear — no interrumpir BullMQ
      console.error('[worker] Error guardando retry_job en PostgreSQL:', dbError);
    }
  });

  workerInstance.on('error', (error) => {
    console.error('[worker] Worker error (conexión Redis):', error.message);
  });

  console.log(`[worker] Worker '${QUEUE_NAME}' iniciado (concurrency=1, limiter=10/min)`);
  return workerInstance;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Cierra el worker limpiamente — espera a que termine el job actual.
 * Llamado desde index.ts al recibir SIGTERM/SIGINT.
 */
export async function closeSyncWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
    console.log('[worker] Worker cerrado');
  }
}

/**
 * Devuelve la instancia actual del worker (para testing).
 */
export function getSyncWorker(): Worker<HubSpotSyncEvent, SyncResult> | null {
  return workerInstance;
}

/**
 * Resetea el worker (para testing).
 */
export function resetSyncWorker(): void {
  workerInstance = null;
}
