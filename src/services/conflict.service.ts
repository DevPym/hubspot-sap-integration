/**
 * conflict.service.ts — Resolución de conflictos Last-Write-Wins (LWW).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Determinar si un evento es más reciente que la última sync         │
 * │  2. Extraer timestamps de HubSpot y SAP en formato comparable (ms)    │
 * │  3. Decidir: PROCEDER o DESCARTAR (SKIPPED)                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - src/services/mapper.service.ts → sapDateTimeToMs,                  │
 * │      sapDateTimeOffsetToMs (parseo de fechas SAP)                       │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/services/sync.service.ts → antes de sincronizar, verifica     │
 * │      si el evento es más nuevo que la última sync                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  REGLAS LWW                                                             │
 * │  ──────────                                                             │
 * │  1. Recibir evento con timestamp T_evento                               │
 * │  2. Consultar id_map.updatedAt = T_ultima_sync                          │
 * │  3. Si T_evento > T_ultima_sync → PROCEDER                             │
 * │  4. Si T_evento <= T_ultima_sync → DESCARTAR (SKIPPED)                 │
 * │                                                                         │
 * │  Caso especial: si no hay sync previa (primer sync), siempre proceder  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  TIMESTAMPS POR ENTIDAD                                                 │
 * │  ────────────────────                                                   │
 * │  HubSpot:                                                               │
 * │    Contact → lastmodifieddate (NO hs_lastmodifieddate, llega null)     │
 * │    Company → hs_lastmodifieddate                                        │
 * │    Deal    → hs_lastmodifieddate                                        │
 * │                                                                         │
 * │  SAP:                                                                   │
 * │    BP      → LastChangeDate + LastChangeTime                            │
 * │    SO      → LastChangeDateTime (DateTimeOffset)                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { sapDateTimeToMs, sapDateTimeOffsetToMs } from './mapper.service';
import type { SapBusinessPartner, SapSalesOrder } from '../adapters/sap/sap.types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ConflictResult {
  /** true si el evento es más reciente y se debe proceder con la sync */
  shouldSync: boolean;
  /** Razón legible del resultado (para auditoría en sync_log) */
  reason: string;
  /** Timestamp del evento en ms (para referencia) */
  eventTimestampMs?: number;
  /** Timestamp de la última sync en ms (para referencia) */
  lastSyncTimestampMs?: number;
}

// ---------------------------------------------------------------------------
// Funciones principales
// ---------------------------------------------------------------------------

/**
 * Evalúa si un evento de HubSpot es más reciente que la última sincronización.
 *
 * @param entityType - Tipo de entidad (CONTACT, COMPANY, DEAL)
 * @param eventTimestamp - Timestamp del evento. Para webhooks: `occurredAt` (epoch ms).
 *                         Para properties: `lastmodifieddate` o `hs_lastmodifieddate` (ISO string).
 * @param lastSyncAt - Fecha de la última sincronización (id_map.updatedAt). null si es primer sync.
 */
export function evaluateHubSpotEvent(
  entityType: 'CONTACT' | 'COMPANY' | 'DEAL',
  eventTimestamp: number | string,
  lastSyncAt: Date | null,
): ConflictResult {
  // Primer sync: siempre proceder
  if (!lastSyncAt) {
    return {
      shouldSync: true,
      reason: `Primer sync para ${entityType} — no hay sync previa`,
    };
  }

  // Convertir eventTimestamp a ms
  const eventMs = typeof eventTimestamp === 'number'
    ? eventTimestamp
    : new Date(eventTimestamp).getTime();

  if (isNaN(eventMs)) {
    return {
      shouldSync: false,
      reason: `Timestamp de evento inválido: ${eventTimestamp}`,
      eventTimestampMs: undefined,
      lastSyncTimestampMs: lastSyncAt.getTime(),
    };
  }

  const lastSyncMs = lastSyncAt.getTime();

  if (eventMs > lastSyncMs) {
    return {
      shouldSync: true,
      reason: `Evento HubSpot (${new Date(eventMs).toISOString()}) es posterior a última sync (${lastSyncAt.toISOString()})`,
      eventTimestampMs: eventMs,
      lastSyncTimestampMs: lastSyncMs,
    };
  }

  return {
    shouldSync: false,
    reason: `Evento HubSpot (${new Date(eventMs).toISOString()}) NO es posterior a última sync (${lastSyncAt.toISOString()}) — SKIPPED`,
    eventTimestampMs: eventMs,
    lastSyncTimestampMs: lastSyncMs,
  };
}

/**
 * Evalúa si un cambio en SAP Business Partner es más reciente que la última sync.
 *
 * @param bp - Business Partner con LastChangeDate y LastChangeTime
 * @param lastSyncAt - Fecha de la última sincronización (id_map.updatedAt). null si es primer sync.
 */
export function evaluateSapBPEvent(
  bp: SapBusinessPartner,
  lastSyncAt: Date | null,
): ConflictResult {
  if (!lastSyncAt) {
    return {
      shouldSync: true,
      reason: 'Primer sync para BP — no hay sync previa',
    };
  }

  const eventMs = sapDateTimeToMs(bp.LastChangeDate, bp.LastChangeTime);

  // LastChangeDate es null hasta el primer PATCH (hallazgo producción #4)
  if (eventMs === undefined) {
    return {
      shouldSync: true,
      reason: 'SAP LastChangeDate es null (BP no modificado aún) — proceder por precaución',
    };
  }

  const lastSyncMs = lastSyncAt.getTime();

  if (eventMs > lastSyncMs) {
    return {
      shouldSync: true,
      reason: `Cambio SAP BP (${new Date(eventMs).toISOString()}) es posterior a última sync (${lastSyncAt.toISOString()})`,
      eventTimestampMs: eventMs,
      lastSyncTimestampMs: lastSyncMs,
    };
  }

  return {
    shouldSync: false,
    reason: `Cambio SAP BP (${new Date(eventMs).toISOString()}) NO es posterior a última sync (${lastSyncAt.toISOString()}) — SKIPPED`,
    eventTimestampMs: eventMs,
    lastSyncTimestampMs: lastSyncMs,
  };
}

/**
 * Evalúa si un cambio en SAP Sales Order es más reciente que la última sync.
 *
 * @param so - Sales Order con LastChangeDateTime
 * @param lastSyncAt - Fecha de la última sincronización. null si es primer sync.
 */
export function evaluateSapSOEvent(
  so: SapSalesOrder,
  lastSyncAt: Date | null,
): ConflictResult {
  if (!lastSyncAt) {
    return {
      shouldSync: true,
      reason: 'Primer sync para SalesOrder — no hay sync previa',
    };
  }

  const eventMs = sapDateTimeOffsetToMs(so.LastChangeDateTime);

  if (eventMs === undefined) {
    return {
      shouldSync: true,
      reason: 'SAP LastChangeDateTime es null — proceder por precaución',
    };
  }

  const lastSyncMs = lastSyncAt.getTime();

  if (eventMs > lastSyncMs) {
    return {
      shouldSync: true,
      reason: `Cambio SAP SO (${new Date(eventMs).toISOString()}) es posterior a última sync (${lastSyncAt.toISOString()})`,
      eventTimestampMs: eventMs,
      lastSyncTimestampMs: lastSyncMs,
    };
  }

  return {
    shouldSync: false,
    reason: `Cambio SAP SO (${new Date(eventMs).toISOString()}) NO es posterior a última sync (${lastSyncAt.toISOString()}) — SKIPPED`,
    eventTimestampMs: eventMs,
    lastSyncTimestampMs: lastSyncMs,
  };
}
