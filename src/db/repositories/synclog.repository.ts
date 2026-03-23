/**
 * synclog.repository.ts — Repositorio para la tabla sync_log.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Insertar registros de auditoría de sincronización                  │
 * │  2. Consultar historial de sync por entidad o recientes                │
 * │  3. Nunca modificar ni borrar registros (tabla inmutable)              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - src/db/prisma.client.ts (acceso a PostgreSQL)                      │
 * │                                                                         │
 * │  Lo usan:                                                               │
 * │    - src/services/sync.service.ts (Fase 5) — registrar cada operación  │
 * │    - Futuros endpoints de dashboard/debug (listar historial)           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FORMATO DE UN REGISTRO                                                 │
 * │  ──────────────────────                                                 │
 * │  {                                                                      │
 * │    entityType: "CONTACT",                                               │
 * │    operation: "CREATE",                                                 │
 * │    sourceSystem: "HUBSPOT",                                             │
 * │    targetSystem: "SAP",                                                 │
 * │    status: "SUCCESS",                                                   │
 * │    inboundPayload: { ... datos del webhook ... },                       │
 * │    outboundPayload: { ... datos enviados a SAP ... },                   │
 * │    errorMessage: null,                                                  │
 * │    attemptNumber: 1                                                     │
 * │  }                                                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { prisma } from '../prisma.client';
import {
  EntityType,
  SystemSource,
  SyncOperation,
  SyncStatus,
  Prisma,
} from '../../generated/prisma/client';

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

interface CreateSyncLogInput {
  idMapId?: string;
  entityType: EntityType;
  operation: SyncOperation;
  sourceSystem: SystemSource;
  targetSystem: SystemSource;
  status: SyncStatus;
  inboundPayload: Prisma.InputJsonValue;
  outboundPayload?: Prisma.InputJsonValue;
  errorMessage?: string;
  errorCode?: string;
  attemptNumber?: number;
}

// ---------------------------------------------------------------------------
// Funciones del repositorio
// ---------------------------------------------------------------------------

/**
 * Inserta un nuevo registro de auditoría.
 *
 * Se llama en cada paso de la sincronización:
 * - Al recibir webhook → status=PENDING
 * - Al enviar a sistema destino → status=IN_FLIGHT
 * - Al completar → status=SUCCESS o FAILED
 * - Si se descarta por anti-bucle → status=SKIPPED
 */
export async function create(data: CreateSyncLogInput) {
  return prisma.syncLog.create({
    data: {
      idMapId: data.idMapId ?? null,
      entityType: data.entityType,
      operation: data.operation,
      sourceSystem: data.sourceSystem,
      targetSystem: data.targetSystem,
      status: data.status,
      inboundPayload: data.inboundPayload,
      outboundPayload: data.outboundPayload ?? Prisma.JsonNull,
      errorMessage: data.errorMessage ?? null,
      errorCode: data.errorCode ?? null,
      attemptNumber: data.attemptNumber ?? 1,
    },
  });
}

/**
 * Obtiene el historial de sincronización de una entidad específica.
 * Ordenado por fecha descendente (más reciente primero).
 *
 * @param idMapId - UUID del mapping en id_map
 * @param limit - Máximo de registros a retornar (default 20)
 */
export async function findByIdMap(idMapId: string, limit = 20) {
  return prisma.syncLog.findMany({
    where: { idMapId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Obtiene los registros de sincronización más recientes.
 * Útil para dashboard de monitoreo y debugging.
 *
 * @param limit - Máximo de registros a retornar (default 50)
 */
export async function findRecent(limit = 50) {
  return prisma.syncLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { idMap: true },
  });
}
