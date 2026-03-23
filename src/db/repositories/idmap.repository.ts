/**
 * idmap.repository.ts — Repositorio para la tabla id_map.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. CRUD de mappings HubSpot ↔ SAP (buscar, crear, actualizar)         │
 * │  2. Mecanismo anti-bucle: adquirir/liberar lock de sincronización      │
 * │  3. Verificar si una entidad está siendo sincronizada (con timeout)    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - src/db/prisma.client.ts (acceso a PostgreSQL)                      │
 * │                                                                         │
 * │  Lo usan:                                                               │
 * │    - src/services/sync.service.ts (Fase 5) — verificar/crear mappings  │
 * │    - src/services/conflict.service.ts (Fase 5) — consultar updatedAt   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ANTI-BUCLE                                                             │
 * │  ──────────                                                             │
 * │  Cuando HubSpot envía un webhook y sincronizamos a SAP, SAP podría     │
 * │  generar un evento de vuelta. Sin anti-bucle, se crearía un loop       │
 * │  infinito: HubSpot → SAP → HubSpot → SAP → ...                        │
 * │                                                                         │
 * │  Flujo:                                                                 │
 * │    1. Recibir webhook de HubSpot                                        │
 * │    2. acquireSyncLock(id, HUBSPOT) → syncInProgress=true               │
 * │    3. Sincronizar a SAP                                                 │
 * │    4. Si SAP genera webhook de vuelta:                                  │
 * │       → isSyncLocked() = true + initiatedBy=HUBSPOT → SKIP             │
 * │    5. releaseSyncLock(id) → syncInProgress=false                       │
 * │                                                                         │
 * │  Timeout: 30s (SYNC_LOCK_TIMEOUT_MS). Si el lock expira, se asume     │
 * │  que la sync falló y el lock se ignora.                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { prisma } from '../prisma.client';
import { EntityType, SystemSource } from '../../generated/prisma/client';

// ---------------------------------------------------------------------------
// Timeout del lock anti-bucle (configurable via env, default 30s)
// ---------------------------------------------------------------------------

const SYNC_LOCK_TIMEOUT_MS = Number(process.env.SYNC_LOCK_TIMEOUT_MS) || 30_000;

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

interface CreateIdMapInput {
  entityType: EntityType;
  hubspotId: string;
  sapId: string;
}

// ---------------------------------------------------------------------------
// Funciones del repositorio
// ---------------------------------------------------------------------------

/**
 * Busca un mapping por tipo de entidad + ID de HubSpot.
 * Retorna null si no existe (entidad no sincronizada aún).
 */
export async function findByHubSpotId(entityType: EntityType, hubspotId: string) {
  return prisma.idMap.findUnique({
    where: {
      entityType_hubspotId: { entityType, hubspotId },
    },
  });
}

/**
 * Busca un mapping por tipo de entidad + ID de SAP.
 * Retorna null si no existe.
 */
export async function findBySapId(entityType: EntityType, sapId: string) {
  return prisma.idMap.findUnique({
    where: {
      entityType_sapId: { entityType, sapId },
    },
  });
}

/**
 * Crea un nuevo mapping HubSpot ↔ SAP.
 * Se llama cuando una entidad se sincroniza por primera vez.
 */
export async function create(data: CreateIdMapInput) {
  return prisma.idMap.create({ data });
}

/**
 * Activa el lock anti-bucle para una entidad.
 * Se llama al INICIO de una sincronización.
 *
 * @param id - UUID del mapping en id_map
 * @param initiatedBy - Sistema que inició la sync (HUBSPOT o SAP)
 */
export async function acquireSyncLock(id: string, initiatedBy: SystemSource) {
  return prisma.idMap.update({
    where: { id },
    data: {
      syncInProgress: true,
      syncInitiatedBy: initiatedBy,
      syncStartedAt: new Date(),
    },
  });
}

/**
 * Desactiva el lock anti-bucle.
 * Se llama al FINALIZAR una sincronización (éxito o fallo).
 */
export async function releaseSyncLock(id: string) {
  return prisma.idMap.update({
    where: { id },
    data: {
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
    },
  });
}

/**
 * Verifica si una entidad está bloqueada por una sync en progreso.
 *
 * Retorna un objeto con:
 * - `locked`: true si hay sync activa Y no expiró el timeout
 * - `initiatedBy`: sistema que inició la sync (solo si locked=true)
 *
 * Si el lock expiró (>30s), retorna locked=false — se asume que la
 * sync falló y el lock quedó huérfano.
 */
export async function isSyncLocked(id: string): Promise<{
  locked: boolean;
  initiatedBy: SystemSource | null;
}> {
  const record = await prisma.idMap.findUnique({ where: { id } });

  if (!record || !record.syncInProgress || !record.syncStartedAt) {
    return { locked: false, initiatedBy: null };
  }

  // Verificar timeout: si pasaron más de 30s, el lock expiró
  const elapsed = Date.now() - record.syncStartedAt.getTime();
  if (elapsed > SYNC_LOCK_TIMEOUT_MS) {
    return { locked: false, initiatedBy: null };
  }

  return { locked: true, initiatedBy: record.syncInitiatedBy };
}
