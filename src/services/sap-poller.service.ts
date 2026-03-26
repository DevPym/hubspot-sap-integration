/**
 * sap-poller.service.ts — Poller que consulta SAP periódicamente
 * buscando cambios y los sincroniza hacia HubSpot.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Consultar SAP por BPs modificados desde la última consulta         │
 * │  2. Consultar SAP por SalesOrders modificados                          │
 * │  3. Para cada entidad modificada con mapeo en id_map:                  │
 * │     a. Leer datos completos de SAP                                     │
 * │     b. Transformar con mapper.service                                   │
 * │     c. Actualizar en HubSpot                                           │
 * │     d. Registrar en sync_log                                            │
 * │  4. Mecanismo anti-bucle: no sincronizar si sync fue iniciada por HS  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - src/adapters/sap/sap.client.ts → leer BPs y SalesOrders          │
 * │    - src/adapters/hubspot/hubspot.client.ts → escribir en HubSpot     │
 * │    - src/services/mapper.service.ts → transformar datos                │
 * │    - src/db/repositories/idmap.repository.ts → buscar mapeos          │
 * │    - src/db/repositories/synclog.repository.ts → auditoría            │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/index.ts → se inicia al arrancar el servidor                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  NOTAS SAP OData v2                                                     │
 * │  ──────────────────                                                     │
 * │  - LastChangeDate es null hasta el primer PATCH                         │
 * │  - $filter con LastChangeDate usa formato datetime'YYYY-MM-DDT...'     │
 * │  - $expand NO funciona con $select                                      │
 * │  - SalesOrder usa LastChangeDateTime (DateTimeOffset, diferente fmt)   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import crypto from 'crypto';
import { sapClient } from '../adapters/sap/sap.client';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import * as mapper from './mapper.service';
import * as idMapRepo from '../db/repositories/idmap.repository';
import * as syncLogRepo from '../db/repositories/synclog.repository';
import { env } from '../config/env';
import type {
  SapBusinessPartner,
  SapBPAddress,
  SapSalesOrder,
  ODataListResponse,
} from '../adapters/sap/sap.types';
import type {
  HubSpotAssociationsResponse,
} from '../adapters/hubspot/hubspot.types';
import type { Prisma } from '../generated/prisma/client';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Intervalo de polling en milisegundos (default: 5 minutos) */
const POLL_INTERVAL_MS = env.SAP_POLL_INTERVAL_MS || 300000;

/** Endpoints SAP */
const SAP_BP_ENDPOINT = '/API_BUSINESS_PARTNER/A_BusinessPartner';
const SAP_SO_ENDPOINT = '/API_SALES_ORDER_SRV/A_SalesOrder';

// ---------------------------------------------------------------------------
// Estado del poller
// ---------------------------------------------------------------------------

let pollerInterval: ReturnType<typeof setInterval> | null = null;
let lastPollTime: Date = new Date(Date.now() - (POLL_INTERVAL_MS || 300000)); // Iniciar desde hace 1 intervalo
let isPolling = false;

/**
 * Cache de hashes de datos sincronizados.
 * Clave: "entityType-sapId", Valor: hash MD5 de los datos.
 * Si el hash no cambió desde la última sync, no se reenvía a HubSpot.
 * Evita el bucle suave: poller→HubSpot→webhook→SAP→poller...
 */
const dataHashCache = new Map<string, string>();

/**
 * Calcula un hash MD5 de un objeto para detectar cambios reales.
 */
function hashData(data: Record<string, unknown>): string {
  const sorted = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash('md5').update(sorted).digest('hex');
}

/**
 * Verifica si los datos han cambiado desde la última sincronización.
 * Retorna true si hay cambios (o si es la primera vez).
 */
function hasDataChanged(cacheKey: string, newData: Record<string, unknown>): boolean {
  const newHash = hashData(newData);
  const oldHash = dataHashCache.get(cacheKey);
  if (oldHash === newHash) return false;
  dataHashCache.set(cacheKey, newHash);
  return true;
}

// ---------------------------------------------------------------------------
// Helper JSON seguro
// ---------------------------------------------------------------------------

function toJson(obj: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Formateo de fechas para filtros OData v2
// ---------------------------------------------------------------------------

/**
 * Convierte un Date a formato OData v2 para $filter.
 * BP usa: datetime'2026-03-24T00:00:00'
 */
function toODataDateTime(date: Date): string {
  return `datetime'${date.toISOString().split('.')[0]}'`;
}

/**
 * Convierte un Date a formato OData DateTimeOffset para $filter.
 * SalesOrder usa: datetimeoffset'2026-03-24T00:00:00Z'
 */
function toODataDateTimeOffset(date: Date): string {
  return `datetimeoffset'${date.toISOString()}'`;
}

// ---------------------------------------------------------------------------
// Poll Business Partners (Contacts + Companies)
// ---------------------------------------------------------------------------

async function pollBusinessPartners(): Promise<void> {
  const filterDate = toODataDateTime(lastPollTime);

  // Filtrar BPs modificados desde la última consulta
  // LastChangeDate puede ser null → filtrar solo los que tienen fecha
  const filter = `LastChangeDate ge ${filterDate}`;

  try {
    const response = await sapClient.get<ODataListResponse<SapBusinessPartner>>(
      `${SAP_BP_ENDPOINT}?$filter=${encodeURIComponent(filter)}&$top=50`,
    );

    const bps = response.data.d.results;
    if (!bps || bps.length === 0) return;

    console.log(`[sap-poller] Encontrados ${bps.length} BPs modificados desde ${lastPollTime.toISOString()}`);

    for (const bp of bps) {
      await syncBPToHubSpot(bp);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[sap-poller] Error consultando BPs:', msg);
  }
}

// ---------------------------------------------------------------------------
// Poll Sales Orders (Deals)
// ---------------------------------------------------------------------------

async function pollSalesOrders(): Promise<void> {
  const filterDate = toODataDateTimeOffset(lastPollTime);

  const filter = `LastChangeDateTime ge ${filterDate}`;

  try {
    const response = await sapClient.get<ODataListResponse<SapSalesOrder>>(
      `${SAP_SO_ENDPOINT}?$filter=${encodeURIComponent(filter)}&$top=50`,
    );

    const orders = response.data.d.results;
    if (!orders || orders.length === 0) return;

    console.log(`[sap-poller] Encontrados ${orders.length} SalesOrders modificados desde ${lastPollTime.toISOString()}`);

    for (const so of orders) {
      await syncSalesOrderToHubSpot(so);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[sap-poller] Error consultando SalesOrders:', msg);
  }
}

// ---------------------------------------------------------------------------
// Sync BP → HubSpot
// ---------------------------------------------------------------------------

async function syncBPToHubSpot(bp: SapBusinessPartner): Promise<void> {
  const sapId = bp.BusinessPartner;
  if (!sapId) return;
  const category = bp.BusinessPartnerCategory;
  const entityType = category === '1' ? 'CONTACT' as const : 'COMPANY' as const;

  // Buscar mapeo en id_map
  const mapping = await idMapRepo.findBySapId(entityType, sapId);
  if (!mapping) {
    // BP no está mapeado — ignorar (fue creado directamente en SAP, no desde HubSpot)
    return;
  }

  // Anti-bucle: si el sync fue iniciado por HubSpot recientemente, ignorar
  if (mapping.syncInProgress && mapping.syncInitiatedBy === 'HUBSPOT') {
    const elapsed = Date.now() - (mapping.syncStartedAt?.getTime() || 0);
    if (elapsed < env.SYNC_LOCK_TIMEOUT_MS) {
      console.log(`[sap-poller] ⏭️ BP ${sapId} — anti-bucle activo (sync iniciada por HubSpot)`);
      return;
    }
  }

  // Comparar timestamps: si SAP no cambió después de nuestro último update, ignorar
  if (bp.LastChangeDate) {
    const sapChangeMatch = bp.LastChangeDate.match(/\/Date\((\d+)\)\//);
    if (sapChangeMatch) {
      const sapChangeMs = parseInt(sapChangeMatch[1], 10);
      const ourLastUpdate = mapping.updatedAt.getTime();
      if (sapChangeMs <= ourLastUpdate) {
        return; // SAP no cambió después de nuestra última sync
      }
    }
  }

  // Leer datos completos del BP (incluyendo address)
  let address: SapBPAddress | undefined;

  try {
    const addrRes = await sapClient.get<ODataListResponse<SapBPAddress>>(
      `${SAP_BP_ENDPOINT}('${sapId}')/to_BusinessPartnerAddress`,
    );
    if (addrRes.data.d.results?.length > 0) {
      address = addrRes.data.d.results[0];
    }
  } catch { /* Address puede no existir */ }

  // Transformar según tipo
  let hubspotProps: Record<string, string>;
  let hsObjectType: string;

  if (entityType === 'CONTACT') {
    hubspotProps = mapper.sapBPToContactUpdate(bp, address) as Record<string, string>;
    hsObjectType = 'contacts';
  } else {
    hubspotProps = mapper.sapBPToCompanyUpdate(bp, address) as Record<string, string>;
    hsObjectType = 'companies';
  }

  // Filtrar undefined/null
  const cleanProps: Record<string, string> = {};
  for (const [key, val] of Object.entries(hubspotProps)) {
    if (val !== undefined && val !== null) cleanProps[key] = val;
  }

  if (Object.keys(cleanProps).length === 0) return;

  // Deduplicación por hash: si los datos no cambiaron realmente, no reenviar
  const cacheKey = `${entityType}-${sapId}`;
  if (!hasDataChanged(cacheKey, cleanProps)) {
    return; // Datos idénticos al último sync — ignorar
  }

  // Activar lock anti-bucle
  await idMapRepo.acquireSyncLock(mapping.id, 'SAP');

  try {
    // PATCH en HubSpot
    await hubspotClient.patch(
      `/crm/v3/objects/${hsObjectType}/${mapping.hubspotId}`,
      { properties: cleanProps },
    );

    console.log(`[sap-poller] ✅ UPDATE ${entityType} SAP:${sapId} → HS:${mapping.hubspotId}`);

    // 🔗 Sincronizar asociación Contact↔Company basada en NaturalPersonEmployerName
    if (entityType === 'CONTACT' && bp.NaturalPersonEmployerName) {
      try {
        await syncContactCompanyAssociation(mapping.hubspotId, bp.NaturalPersonEmployerName);
      } catch (assocError) {
        // No bloquear la sync principal por error en asociación
        const assocMsg = assocError instanceof Error ? assocError.message : String(assocError);
        console.error(`[sap-poller] ⚠️ Error sincronizando asociación Contact↔Company: ${assocMsg}`);
      }
    }

    // Log: SUCCESS
    await syncLogRepo.create({
      idMapId: mapping.id,
      entityType,
      operation: 'UPDATE',
      sourceSystem: 'SAP',
      targetSystem: 'HUBSPOT',
      status: 'SUCCESS',
      inboundPayload: toJson({ sapId, category }),
      outboundPayload: toJson(cleanProps),
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // HubSpot 400 por email duplicado: reintentar sin email
    const isEmailConflict = msg.includes('already has that value') && cleanProps.email;
    if (isEmailConflict) {
      console.warn(`[sap-poller] ⚠️ Email duplicado en HubSpot, reintentando sin email para BP ${sapId}`);
      const { email: _, ...propsWithoutEmail } = cleanProps;
      try {
        if (Object.keys(propsWithoutEmail).length > 0) {
          await hubspotClient.patch(
            `/crm/v3/objects/${hsObjectType}/${mapping.hubspotId}`,
            { properties: propsWithoutEmail },
          );
          console.log(`[sap-poller] ✅ UPDATE (sin email) ${entityType} SAP:${sapId} → HS:${mapping.hubspotId}`);
          await syncLogRepo.create({
            idMapId: mapping.id,
            entityType,
            operation: 'UPDATE',
            sourceSystem: 'SAP',
            targetSystem: 'HUBSPOT',
            status: 'SUCCESS',
            inboundPayload: toJson({ sapId, category, note: 'email excluido por duplicado' }),
            outboundPayload: toJson(propsWithoutEmail),
          });
          return; // Salir del catch, no registrar como FAILED
        }
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error(`[sap-poller] ❌ Reintento sin email también falló para BP ${sapId}:`, retryMsg);
      }
    }

    console.error(`[sap-poller] ❌ Error syncing BP ${sapId}:`, msg);

    await syncLogRepo.create({
      idMapId: mapping.id,
      entityType,
      operation: 'UPDATE',
      sourceSystem: 'SAP',
      targetSystem: 'HUBSPOT',
      status: 'FAILED',
      inboundPayload: toJson({ sapId }),
      errorMessage: msg,
      errorCode: 'SAP_POLL_ERROR',
    });
  } finally {
    await idMapRepo.releaseSyncLock(mapping.id);
  }
}

// ---------------------------------------------------------------------------
// Helpers de asociaciones HubSpot
// ---------------------------------------------------------------------------

/**
 * Sincroniza la asociación Deal↔Company en HubSpot basándose en SoldToParty de SAP.
 *
 * Flujo:
 *   1. Leer SoldToParty del SalesOrder (SAP BP ID de la Company)
 *   2. Buscar ese SAP BP ID en id_map → obtener hubspotId de la Company
 *   3. Leer asociaciones actuales del Deal en HubSpot
 *   4. Si no hay asociación o es diferente → crear la nueva asociación
 *
 * ⚠️ No falla si la asociación no se puede crear — solo loguea el error.
 * ⚠️ Usa API v4 de asociaciones (PUT /crm/v4/objects/deals/{}/associations/companies/{})
 *    con fallback a v3 (PUT /crm/v3/objects/deals/{}/associations/company/{}/deal_to_company)
 */
async function syncDealCompanyAssociation(
  dealHubSpotId: string,
  soldToParty: string,
): Promise<void> {
  // 1. Buscar la Company en id_map por el SAP BP ID (SoldToParty)
  const companyMapping = await idMapRepo.findBySapId('COMPANY', soldToParty);
  if (!companyMapping) {
    // La Company no está mapeada — posiblemente creada directamente en SAP
    console.log(`[sap-poller] ℹ️ SoldToParty ${soldToParty} no encontrada en id_map — asociación Deal↔Company no sincronizada`);
    return;
  }

  const companyHubSpotId = companyMapping.hubspotId;

  // 2. Leer asociaciones actuales del Deal en HubSpot
  try {
    const assocResponse = await hubspotClient.get<HubSpotAssociationsResponse>(
      `/crm/v3/objects/deals/${dealHubSpotId}/associations/company`,
    );

    const currentAssociations = assocResponse.data.results || [];

    // 3. ¿La Company ya está asociada?
    const alreadyAssociated = currentAssociations.some(
      (a) => a.id === companyHubSpotId,
    );

    if (alreadyAssociated) {
      return; // Ya está vinculada — nada que hacer
    }
  } catch {
    // Si falla el GET de asociaciones, intentar crear de todas formas
  }

  // 4. Crear la asociación Deal→Company
  try {
    // Intentar con API v4 primero (más robusta)
    await hubspotClient.put(
      `/crm/v4/objects/deals/${dealHubSpotId}/associations/companies/${companyHubSpotId}`,
      [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }], // 5 = deal_to_company
    );
    console.log(`[sap-poller] 🔗 Asociación Deal↔Company creada: HS Deal ${dealHubSpotId} → HS Company ${companyHubSpotId}`);
  } catch {
    // Fallback a v3
    try {
      await hubspotClient.put(
        `/crm/v3/objects/deals/${dealHubSpotId}/associations/company/${companyHubSpotId}/deal_to_company`,
      );
      console.log(`[sap-poller] 🔗 Asociación Deal↔Company creada (v3): HS Deal ${dealHubSpotId} → HS Company ${companyHubSpotId}`);
    } catch (v3Error) {
      const msg = v3Error instanceof Error ? v3Error.message : String(v3Error);
      console.error(`[sap-poller] ⚠️ No se pudo crear asociación Deal↔Company: ${msg}`);
    }
  }
}

/**
 * Sincroniza la asociación Contact↔Company en HubSpot.
 *
 * En SAP no existe un vínculo formal BP Persona → BP Organización.
 * El campo NaturalPersonEmployerName es texto libre (max 35 chars).
 *
 * Estrategia: Buscar en id_map todas las Companies sincronizadas cuyo nombre
 * coincida con NaturalPersonEmployerName. Si hay match exacto → crear asociación.
 *
 * ⚠️ Esto es best-effort — si no hay match, no se crea la asociación.
 */
async function syncContactCompanyAssociation(
  contactHubSpotId: string,
  employerName: string | undefined,
): Promise<void> {
  if (!employerName || employerName.trim() === '') return;

  const trimmedName = employerName.trim();

  // Buscar en HubSpot Companies por nombre exacto usando la Search API
  try {
    const searchResponse = await hubspotClient.post<{
      results: Array<{ id: string; properties: { name?: string } }>;
    }>(
      '/crm/v3/objects/companies/search',
      {
        filterGroups: [{
          filters: [{
            propertyName: 'name',
            operator: 'EQ',
            value: trimmedName,
          }],
        }],
        properties: ['name'],
        limit: 1,
      },
    );

    const companies = searchResponse.data.results || [];
    if (companies.length === 0) {
      return; // No hay Company con ese nombre en HubSpot
    }

    const companyHubSpotId = companies[0].id;

    // Verificar que esta Company está en id_map (es una Company sincronizada)
    const companyMapping = await idMapRepo.findByHubSpotId('COMPANY', companyHubSpotId);
    if (!companyMapping) {
      return; // Company existe en HubSpot pero no está sincronizada — no vincular
    }

    // Verificar si ya existe la asociación
    const assocResponse = await hubspotClient.get<HubSpotAssociationsResponse>(
      `/crm/v3/objects/contacts/${contactHubSpotId}/associations/company`,
    );

    const currentAssociations = assocResponse.data.results || [];
    const alreadyAssociated = currentAssociations.some(
      (a) => a.id === companyHubSpotId,
    );

    if (alreadyAssociated) return;

    // Crear la asociación Contact→Company
    try {
      await hubspotClient.put(
        `/crm/v4/objects/contacts/${contactHubSpotId}/associations/companies/${companyHubSpotId}`,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }], // 1 = contact_to_company
      );
      console.log(`[sap-poller] 🔗 Asociación Contact↔Company creada: HS Contact ${contactHubSpotId} → HS Company ${companyHubSpotId} (por NaturalPersonEmployerName="${trimmedName}")`);
    } catch {
      // Fallback a v3
      try {
        await hubspotClient.put(
          `/crm/v3/objects/contacts/${contactHubSpotId}/associations/company/${companyHubSpotId}/contact_to_company`,
        );
        console.log(`[sap-poller] 🔗 Asociación Contact↔Company creada (v3): HS Contact ${contactHubSpotId} → HS Company ${companyHubSpotId}`);
      } catch (v3Error) {
        const msg = v3Error instanceof Error ? v3Error.message : String(v3Error);
        console.error(`[sap-poller] ⚠️ No se pudo crear asociación Contact↔Company: ${msg}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[sap-poller] ⚠️ Error buscando Company por nombre "${trimmedName}": ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Sync SalesOrder → HubSpot
// ---------------------------------------------------------------------------

async function syncSalesOrderToHubSpot(so: SapSalesOrder): Promise<void> {
  const sapId = so.SalesOrder || '';

  // Buscar mapeo
  const mapping = await idMapRepo.findBySapId('DEAL', sapId);
  if (!mapping) return;

  // Anti-bucle
  if (mapping.syncInProgress && mapping.syncInitiatedBy === 'HUBSPOT') {
    const elapsed = Date.now() - (mapping.syncStartedAt?.getTime() || 0);
    if (elapsed < env.SYNC_LOCK_TIMEOUT_MS) {
      console.log(`[sap-poller] ⏭️ SO ${sapId} — anti-bucle activo`);
      return;
    }
  }

  const hubspotProps = mapper.salesOrderToDealUpdate(so) as Record<string, string>;

  const cleanProps: Record<string, string> = {};
  for (const [key, val] of Object.entries(hubspotProps)) {
    if (val !== undefined && val !== null) cleanProps[key] = val;
  }

  if (Object.keys(cleanProps).length === 0) return;

  // Deduplicación por hash
  const cacheKey = `DEAL-${sapId}`;
  if (!hasDataChanged(cacheKey, cleanProps)) return;

  await idMapRepo.acquireSyncLock(mapping.id, 'SAP');

  try {
    await hubspotClient.patch(
      `/crm/v3/objects/deals/${mapping.hubspotId}`,
      { properties: cleanProps },
    );

    console.log(`[sap-poller] ✅ UPDATE DEAL SAP:${sapId} → HS:${mapping.hubspotId}`);

    // 🔗 Sincronizar asociación Deal↔Company basada en SoldToParty
    if (so.SoldToParty) {
      try {
        await syncDealCompanyAssociation(mapping.hubspotId, so.SoldToParty);
      } catch (assocError) {
        // No bloquear la sync principal por error en asociación
        const assocMsg = assocError instanceof Error ? assocError.message : String(assocError);
        console.error(`[sap-poller] ⚠️ Error sincronizando asociación Deal↔Company: ${assocMsg}`);
      }
    }

    await syncLogRepo.create({
      idMapId: mapping.id,
      entityType: 'DEAL',
      operation: 'UPDATE',
      sourceSystem: 'SAP',
      targetSystem: 'HUBSPOT',
      status: 'SUCCESS',
      inboundPayload: toJson({ sapId }),
      outboundPayload: toJson(cleanProps),
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[sap-poller] ❌ Error syncing SO ${sapId}:`, msg);

    await syncLogRepo.create({
      idMapId: mapping.id,
      entityType: 'DEAL',
      operation: 'UPDATE',
      sourceSystem: 'SAP',
      targetSystem: 'HUBSPOT',
      status: 'FAILED',
      inboundPayload: toJson({ sapId }),
      errorMessage: msg,
      errorCode: 'SAP_POLL_ERROR',
    });
  } finally {
    await idMapRepo.releaseSyncLock(mapping.id);
  }
}

// ---------------------------------------------------------------------------
// Ciclo de polling
// ---------------------------------------------------------------------------

async function pollCycle(): Promise<void> {
  if (isPolling) {
    console.log('[sap-poller] ⏭️ Poll anterior aún en progreso, saltando ciclo');
    return;
  }

  isPolling = true;
  const cycleStart = new Date();

  try {
    console.log(`[sap-poller] 🔄 Iniciando poll (desde ${lastPollTime.toISOString()})`);

    await pollBusinessPartners();
    await pollSalesOrders();

    lastPollTime = cycleStart;
    console.log(`[sap-poller] ✅ Poll completado`);
  } catch (error) {
    console.error('[sap-poller] Error en ciclo de poll:', error instanceof Error ? error.message : error);
  } finally {
    isPolling = false;
  }
}

// ---------------------------------------------------------------------------
// Control del poller (start/stop)
// ---------------------------------------------------------------------------

/**
 * Inicia el poller de SAP.
 * Ejecuta un ciclo inmediato y luego cada POLL_INTERVAL_MS.
 */
export function startSapPoller(): void {
  if (pollerInterval) {
    console.log('[sap-poller] Poller ya está activo');
    return;
  }

  console.log(
    `[sap-poller] Poller iniciado (intervalo: ${POLL_INTERVAL_MS / 1000}s, ` +
    `desde: ${lastPollTime.toISOString()})`,
  );

  // Primer poll después de 30s (dar tiempo a que el servidor arranque)
  setTimeout(() => {
    pollCycle();
    pollerInterval = setInterval(pollCycle, POLL_INTERVAL_MS);
  }, 30000);
}

/**
 * Detiene el poller de SAP.
 */
export function stopSapPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
    console.log('[sap-poller] Poller detenido');
  }
}

/**
 * Ejecuta un ciclo de poll manualmente (útil para testing).
 */
export async function manualPoll(): Promise<void> {
  await pollCycle();
}
