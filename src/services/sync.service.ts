/**
 * sync.service.ts — Orquestador principal de sincronización bidireccional.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Recibir eventos de HubSpot (webhooks) o SAP (poller futuro)       │
 * │  2. Determinar si es CREATE o UPDATE según existencia en id_map       │
 * │  3. Verificar anti-bucle (no reenviar eco de nuestra propia sync)     │
 * │  4. Verificar Last-Write-Wins (no sobrescribir datos más nuevos)      │
 * │  5. Transformar datos con mapper.service                               │
 * │  6. Enviar al sistema destino (SAP o HubSpot)                         │
 * │  7. Registrar auditoría en sync_log                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - src/services/mapper.service.ts → transformar datos                 │
 * │    - src/services/conflict.service.ts → Last-Write-Wins                │
 * │    - src/db/repositories/idmap.repository.ts → mappings + anti-bucle  │
 * │    - src/db/repositories/synclog.repository.ts → auditoría            │
 * │    - src/adapters/sap/sap.client.ts → leer/escribir en SAP            │
 * │    - src/adapters/hubspot/hubspot.client.ts → leer/escribir HubSpot   │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/queue/sync.worker.ts (Fase 6) → procesamiento async con cola │
 * │    - src/scripts/integration-test.ts (Fase 5B) → pruebas reales       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLUJO COMPLETO (HubSpot → SAP)                                        │
 * │  ─────────────────────────────                                          │
 * │  1. Recibir evento webhook (objectId, subscriptionType, occurredAt)    │
 * │  2. Buscar en id_map por hubspotId                                      │
 * │     ├── NO existe → CREATE:                                             │
 * │     │   a. Leer datos completos de HubSpot                             │
 * │     │   b. Transformar con mapper                                       │
 * │     │   c. POST a SAP → obtener SAP ID                                 │
 * │     │   d. Crear mapping en id_map                                      │
 * │     │   e. Log: SUCCESS                                                 │
 * │     └── SÍ existe → UPDATE:                                             │
 * │         a. ¿Anti-bucle activo? → SKIP                                   │
 * │         b. ¿LWW dice que es viejo? → SKIP                              │
 * │         c. Activar lock anti-bucle                                      │
 * │         d. Leer datos completos de HubSpot                             │
 * │         e. Transformar con mapper (solo update)                         │
 * │         f. PATCH a SAP con ETag                                         │
 * │         g. Liberar lock                                                 │
 * │         h. Log: SUCCESS                                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  VÍNCULO DEAL → COMPANY                                                │
 * │  ─────────────────────                                                  │
 * │  Un Deal de HubSpot necesita una Company asociada para crear la        │
 * │  Sales Order en SAP (campo SoldToParty = SAP BP ID).                   │
 * │  Si la Company no existe en id_map, el sync del Deal FALLA.            │
 * │  El worker (Fase 6) puede reencolar el job para reintento.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { sapClient } from '../adapters/sap/sap.client';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import * as idMapRepo from '../db/repositories/idmap.repository';
import * as syncLogRepo from '../db/repositories/synclog.repository';
import * as mapper from './mapper.service';
import * as conflict from './conflict.service';
import type { ODataResponse } from '../adapters/sap/sap.types';
import type {
  HubSpotContact,
  HubSpotCompany,
  HubSpotDeal,
  HubSpotAssociationsResponse,
} from '../adapters/hubspot/hubspot.types';
import type { EntityType, SystemSource } from '../generated/prisma/client';
import type { Prisma } from '../generated/prisma/client';

// Helper para convertir objetos a InputJsonValue compatible con Prisma 7
function toJson(obj: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

/** Datos mínimos de un evento webhook de HubSpot para iniciar sync */
export interface HubSpotSyncEvent {
  objectId: string;
  entityType: EntityType;
  /** Epoch ms del evento (occurredAt del webhook) */
  occurredAt: number;
  /** Tipo de suscripción del webhook (ej: 'contact.propertyChange') */
  subscriptionType: string;
}

/** Resultado de una operación de sync */
export interface SyncResult {
  success: boolean;
  operation: 'CREATE' | 'UPDATE' | 'SKIPPED';
  entityType: EntityType;
  hubspotId: string;
  sapId?: string;
  reason?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Endpoints de API por tipo de entidad
// ---------------------------------------------------------------------------

const HUBSPOT_ENDPOINTS: Record<EntityType, string> = {
  CONTACT: '/crm/v3/objects/contacts',
  COMPANY: '/crm/v3/objects/companies',
  DEAL: '/crm/v3/objects/deals',
};

const HUBSPOT_PROPERTIES: Record<EntityType, string> = {
  CONTACT: 'firstname,lastname,email,phone,mobilephone,fax,address,city,zip,country,state,company,jobtitle,salutation,industry,lastmodifieddate,comuna',
  COMPANY: 'name,description,phone,industry,founded_year,address,city,zip,country,state,hs_lastmodifieddate,comuna,rut,condicion_venta,razon_social,banco_1,banco_2',
  DEAL: 'dealname,amount,closedate,deal_currency_code,dealstage,pipeline,hubspot_owner_id,hs_lastmodifieddate,condicion_de_pago,fecha_de_entrega,orden_de_compra,cantidad_producto',
};

const SAP_BP_ENDPOINT = '/API_BUSINESS_PARTNER/A_BusinessPartner';
const SAP_SO_ENDPOINT = '/API_SALES_ORDER_SRV/A_SalesOrder';

// ---------------------------------------------------------------------------
// Sincronización HubSpot → SAP
// ---------------------------------------------------------------------------

/**
 * Procesa un evento de webhook de HubSpot y sincroniza a SAP.
 * Es el punto de entrada principal para la sincronización HS → SAP.
 */
export async function syncHubSpotToSap(event: HubSpotSyncEvent): Promise<SyncResult> {
  const { objectId, entityType, occurredAt } = event;
  const source: SystemSource = 'HUBSPOT';
  const target: SystemSource = 'SAP';

  try {
    // Paso 1: ¿Existe mapping?
    const existingMap = await idMapRepo.findByHubSpotId(entityType, objectId);

    if (!existingMap) {
      // ---------- CREATE ----------
      return await handleCreate(entityType, objectId, occurredAt, source, target);
    } else {
      // ---------- UPDATE ----------
      return await handleUpdate(entityType, objectId, occurredAt, existingMap, source, target);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Log de error
    await syncLogRepo.create({
      entityType,
      operation: 'UPDATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'FAILED',
      inboundPayload: toJson({ objectId, occurredAt }),
      errorMessage: errorMsg,
      errorCode: 'SYNC_ERROR',
    });

    return {
      success: false,
      operation: 'UPDATE',
      entityType,
      hubspotId: objectId,
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// CREATE: Entidad nueva — crear en SAP + registrar mapping
// ---------------------------------------------------------------------------

async function handleCreate(
  entityType: EntityType,
  hubspotId: string,
  occurredAt: number,
  source: SystemSource,
  target: SystemSource,
): Promise<SyncResult> {
  // Log: PENDING
  await syncLogRepo.create({
    entityType,
    operation: 'CREATE',
    sourceSystem: source,
    targetSystem: target,
    status: 'PENDING',
    inboundPayload: toJson({ hubspotId, occurredAt }),
  });

  // Leer datos completos de HubSpot
  const hubspotData = await fetchHubSpotEntity(entityType, hubspotId);

  let sapId: string;
  let outboundPayload: Prisma.InputJsonValue;

  if (entityType === 'CONTACT') {
    const contact = hubspotData as HubSpotContact;
    const payload = mapper.contactToSapBP(contact.properties, hubspotId);
    outboundPayload = toJson(payload);

    // Log: IN_FLIGHT
    await syncLogRepo.create({
      entityType,
      operation: 'CREATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'IN_FLIGHT',
      inboundPayload: toJson(contact.properties),
      outboundPayload,
    });

    const response = await sapClient.post<ODataResponse<{ BusinessPartner: string }>>(
      SAP_BP_ENDPOINT,
      payload,
    );
    sapId = response.data.d.BusinessPartner;

  } else if (entityType === 'COMPANY') {
    const company = hubspotData as HubSpotCompany;
    const payload = mapper.companyToSapBP(company.properties, hubspotId);
    outboundPayload = toJson(payload);

    await syncLogRepo.create({
      entityType,
      operation: 'CREATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'IN_FLIGHT',
      inboundPayload: toJson(company.properties),
      outboundPayload,
    });

    const response = await sapClient.post<ODataResponse<{ BusinessPartner: string }>>(
      SAP_BP_ENDPOINT,
      payload,
    );
    sapId = response.data.d.BusinessPartner;

  } else if (entityType === 'DEAL') {
    const deal = hubspotData as HubSpotDeal;

    // ⭐ Obtener Company asociada al Deal
    const sapCompanyId = await resolveCompanyForDeal(hubspotId);
    if (!sapCompanyId) {
      await syncLogRepo.create({
        entityType,
        operation: 'CREATE',
        sourceSystem: source,
        targetSystem: target,
        status: 'FAILED',
        inboundPayload: toJson(deal.properties),
        errorMessage: 'Company asociada al Deal no encontrada en id_map. Debe sincronizarse primero.',
        errorCode: 'MISSING_COMPANY',
      });

      return {
        success: false,
        operation: 'CREATE',
        entityType,
        hubspotId,
        error: 'Company asociada no sincronizada. Requiere sync previo de Company.',
      };
    }

    const payload = mapper.dealToSalesOrder(deal.properties, sapCompanyId);
    outboundPayload = toJson(payload);

    await syncLogRepo.create({
      entityType,
      operation: 'CREATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'IN_FLIGHT',
      inboundPayload: toJson(deal.properties),
      outboundPayload,
    });

    const response = await sapClient.post<ODataResponse<{ SalesOrder: string }>>(
      SAP_SO_ENDPOINT,
      payload,
    );
    sapId = response.data.d.SalesOrder;

  } else {
    throw new Error(`EntityType no soportado: ${entityType}`);
  }

  // Crear mapping en id_map
  const newMap = await idMapRepo.create({ entityType, hubspotId, sapId });

  // Log: SUCCESS
  await syncLogRepo.create({
    idMapId: newMap.id,
    entityType,
    operation: 'CREATE',
    sourceSystem: source,
    targetSystem: target,
    status: 'SUCCESS',
    inboundPayload: toJson({ hubspotId }),
    outboundPayload: toJson({ sapId }),
  });

  return {
    success: true,
    operation: 'CREATE',
    entityType,
    hubspotId,
    sapId,
  };
}

// ---------------------------------------------------------------------------
// UPDATE: Entidad existente — verificar locks + LWW + PATCH
// ---------------------------------------------------------------------------

async function handleUpdate(
  entityType: EntityType,
  hubspotId: string,
  occurredAt: number,
  existingMap: { id: string; sapId: string; updatedAt: Date },
  source: SystemSource,
  target: SystemSource,
): Promise<SyncResult> {
  const { id: mapId, sapId, updatedAt } = existingMap;

  // Paso 2a: ¿Anti-bucle activo?
  const lockStatus = await idMapRepo.isSyncLocked(mapId);
  if (lockStatus.locked && lockStatus.initiatedBy !== source) {
    // Es eco de nuestra propia sync → SKIP
    await syncLogRepo.create({
      idMapId: mapId,
      entityType,
      operation: 'UPDATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'SKIPPED',
      inboundPayload: toJson({ hubspotId, occurredAt }),
      errorMessage: `Anti-bucle: sync iniciada por ${lockStatus.initiatedBy}, descartando eco de ${source}`,
      errorCode: 'ANTI_LOOP',
    });

    return {
      success: true,
      operation: 'SKIPPED',
      entityType,
      hubspotId,
      sapId,
      reason: `Anti-bucle activo (iniciado por ${lockStatus.initiatedBy})`,
    };
  }

  // Paso 2b: ¿LWW dice que es más nuevo?
  const lwwResult = conflict.evaluateHubSpotEvent(entityType, occurredAt, updatedAt);
  if (!lwwResult.shouldSync) {
    await syncLogRepo.create({
      idMapId: mapId,
      entityType,
      operation: 'UPDATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'SKIPPED',
      inboundPayload: toJson({ hubspotId, occurredAt }),
      errorMessage: lwwResult.reason,
      errorCode: 'LWW_STALE',
    });

    return {
      success: true,
      operation: 'SKIPPED',
      entityType,
      hubspotId,
      sapId,
      reason: lwwResult.reason,
    };
  }

  // Paso 2c: Activar lock anti-bucle
  await idMapRepo.acquireSyncLock(mapId, source);

  try {
    // Leer datos completos de HubSpot
    const hubspotData = await fetchHubSpotEntity(entityType, hubspotId);

    let outboundPayload: Prisma.InputJsonValue;
    let sapPath: string;

    if (entityType === 'CONTACT') {
      const contact = hubspotData as HubSpotContact;
      const updatePayload = mapper.contactToSapBPUpdate(contact.properties);
      outboundPayload = toJson(updatePayload);
      sapPath = `${SAP_BP_ENDPOINT}('${sapId}')`;
    } else if (entityType === 'COMPANY') {
      const company = hubspotData as HubSpotCompany;
      const updatePayload = mapper.companyToSapBPUpdate(company.properties);
      outboundPayload = toJson(updatePayload);
      sapPath = `${SAP_BP_ENDPOINT}('${sapId}')`;
    } else if (entityType === 'DEAL') {
      const deal = hubspotData as HubSpotDeal;
      const updatePayload = mapper.dealToSalesOrderUpdate(deal.properties);
      outboundPayload = toJson(updatePayload);
      sapPath = `${SAP_SO_ENDPOINT}('${sapId}')`;
    } else {
      throw new Error(`EntityType no soportado: ${entityType}`);
    }

    // Log: IN_FLIGHT
    await syncLogRepo.create({
      idMapId: mapId,
      entityType,
      operation: 'UPDATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'IN_FLIGHT',
      inboundPayload: toJson({ hubspotId, occurredAt }),
      outboundPayload,
    });

    // PATCH con ETag automático
    await sapClient.patchWithETag(sapPath, outboundPayload);

    // Log: SUCCESS
    await syncLogRepo.create({
      idMapId: mapId,
      entityType,
      operation: 'UPDATE',
      sourceSystem: source,
      targetSystem: target,
      status: 'SUCCESS',
      inboundPayload: toJson({ hubspotId }),
      outboundPayload,
    });

    return {
      success: true,
      operation: 'UPDATE',
      entityType,
      hubspotId,
      sapId,
    };
  } finally {
    // SIEMPRE liberar lock (éxito o error)
    await idMapRepo.releaseSyncLock(mapId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lee una entidad completa de HubSpot con todas las propiedades necesarias.
 */
async function fetchHubSpotEntity(
  entityType: EntityType,
  hubspotId: string,
): Promise<HubSpotContact | HubSpotCompany | HubSpotDeal> {
  const endpoint = HUBSPOT_ENDPOINTS[entityType];
  const properties = HUBSPOT_PROPERTIES[entityType];

  const response = await hubspotClient.get<HubSpotContact | HubSpotCompany | HubSpotDeal>(
    `${endpoint}/${hubspotId}`,
    { params: { properties } },
  );

  return response.data;
}

/**
 * Resuelve el SAP Business Partner ID de la Company asociada a un Deal.
 *
 * Flujo:
 *   1. Obtener asociaciones del Deal en HubSpot → Company ID
 *   2. Buscar Company ID en id_map → SAP BP ID
 *
 * Retorna null si la Company no está sincronizada aún.
 */
async function resolveCompanyForDeal(dealHubSpotId: string): Promise<string | null> {
  // Obtener asociaciones del Deal
  const assocResponse = await hubspotClient.get<HubSpotAssociationsResponse>(
    `${HUBSPOT_ENDPOINTS.DEAL}/${dealHubSpotId}/associations/company`,
  );

  const associations = assocResponse.data.results;
  if (!associations || associations.length === 0) {
    return null;
  }

  // Tomar la primera Company asociada
  const companyHubSpotId = associations[0].id;

  // Buscar en id_map
  const companyMap = await idMapRepo.findByHubSpotId('COMPANY', companyHubSpotId);
  if (!companyMap) {
    return null;
  }

  return companyMap.sapId;
}
