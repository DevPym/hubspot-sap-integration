/**
 * sync.queue.ts — Cola BullMQ para procesamiento asíncrono de webhooks.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Crear instancia de Queue conectada a Redis (Railway)               │
 * │  2. Exportar helper addSyncJob() para encolar eventos de webhook       │
 * │  3. Configurar retries con backoff exponencial                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Lee:                                                                   │
 * │    - env.REDIS_URL → conexión a Redis                                  │
 * │    - env.MAX_RETRY_ATTEMPTS → número máximo de reintentos              │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/api/routes/hubspot.routes.ts → encola eventos de webhook      │
 * │    - src/queue/sync.worker.ts → procesa jobs de esta cola              │
 * │    - src/index.ts → cierre graceful                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { Queue, type JobsOptions } from 'bullmq';
import { env } from '../config/env';
import type { HubSpotSyncEvent } from '../services/sync.service';

// ---------------------------------------------------------------------------
// Nombre de la cola — compartido entre Queue y Worker
// ---------------------------------------------------------------------------

export const QUEUE_NAME = 'hubspot-sap-sync';

// ---------------------------------------------------------------------------
// Conexión Redis — se extrae host/port/password desde REDIS_URL
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

const redisConnection = parseRedisUrl(env.REDIS_URL);

// ---------------------------------------------------------------------------
// Instancia de la cola
// ---------------------------------------------------------------------------

/**
 * Cola BullMQ para sincronización HubSpot → SAP.
 *
 * Cada job contiene un HubSpotSyncEvent (datos mínimos del webhook).
 * La cola persiste en Redis — los jobs sobreviven reinicios del proceso.
 */
export const syncQueue = new Queue<HubSpotSyncEvent>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: env.MAX_RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: 1000, // 1s, 2s, 4s, 8s, 16s
    },
    removeOnComplete: {
      count: 1000, // Mantener últimos 1000 jobs completados para debugging
    },
    removeOnFail: {
      count: 5000, // Mantener últimos 5000 jobs fallidos
    },
  },
});

// ---------------------------------------------------------------------------
// Helper para encolar jobs
// ---------------------------------------------------------------------------

/**
 * Encola un evento de webhook de HubSpot para procesamiento asíncrono.
 *
 * El jobId se construye como "{entityType}-{objectId}-{occurredAt}" para
 * evitar duplicados si HubSpot reenvía el mismo webhook.
 *
 * @param event Datos mínimos del evento (objectId, entityType, occurredAt, subscriptionType)
 * @param options Opciones adicionales de BullMQ (opcional)
 * @returns El job creado
 */
export async function addSyncJob(event: HubSpotSyncEvent, options?: JobsOptions) {
  const jobId = `${event.entityType}-${event.objectId}-${event.occurredAt}`;

  return syncQueue.add(
    event.subscriptionType, // Nombre del job (para filtrar en dashboard)
    event,                  // Datos del job
    {
      jobId,                // Deduplicación — mismo evento no se procesa dos veces
      ...options,
    },
  );
}

// ---------------------------------------------------------------------------
// Utilidades para cierre graceful
// ---------------------------------------------------------------------------

/**
 * Cierra la cola limpiamente — espera a que termine el job actual.
 * Llamado desde index.ts al recibir SIGTERM/SIGINT.
 */
export async function closeSyncQueue(): Promise<void> {
  await syncQueue.close();
  console.log('[queue] Cola de sync cerrada');
}
