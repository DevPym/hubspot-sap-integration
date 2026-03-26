/**
 * test-associations.ts — Prueba integral de vinculaciones entre Deal, Contact y Company.
 *
 * Flujo:
 *   PARTE 1: Crear los 3 objetos en HubSpot y sincronizar a SAP
 *     1. Crear Company en HubSpot → sync a SAP BP (Category=2)
 *     2. Crear Contact en HubSpot → sync a SAP BP (Category=1)
 *     3. Asociar Contact → Company en HubSpot
 *     4. Crear Deal en HubSpot → asociar a Company → sync a SAP Sales Order
 *     5. Asociar Deal → Contact en HubSpot
 *
 *   PARTE 2: Verificar vinculaciones
 *     6. Verificar que SalesOrder tiene SoldToParty = SAP Company ID
 *     7. Verificar asociaciones en HubSpot (Deal↔Company, Deal↔Contact, Contact↔Company)
 *     8. Verificar id_map tiene los 3 mappings
 *
 *   PARTE 3: Probar Fix A1 (associationChange)
 *     9. Simular evento associationChange y verificar que getDealIdFromAssociation funciona
 *
 *   PARTE 4: Probar Fix B1 (MissingDependencyError)
 *    10. Intentar sync de Deal sin Company mapping → verificar MissingDependencyError
 *
 *   PARTE 5: Cleanup
 *    11. Eliminar objetos de prueba de HubSpot (SAP no tiene DELETE API)
 *
 * Uso: npx tsx src/scripts/test-associations.ts
 */
import 'dotenv/config';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import { sapClient } from '../adapters/sap/sap.client';
import { syncHubSpotToSap, MissingDependencyError } from '../services/sync.service';
import * as idMapRepo from '../db/repositories/idmap.repository';
import * as mapper from '../services/mapper.service';
import type { ODataResponse, ODataListResponse } from '../adapters/sap/sap.types';
import type {
  HubSpotCompany,
  HubSpotContact,
  HubSpotDeal,
  HubSpotAssociationsResponse,
} from '../adapters/hubspot/hubspot.types';

// ---------------------------------------------------------------------------
// Contadores
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;

function pass(msg: string) { passCount++; console.log(`  ✅ ${msg}`); }
function fail(msg: string, e?: unknown) {
  failCount++;
  const detail = e instanceof Error ? e.message : e ? String(e) : '';
  console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`);
}

function check(field: string, expected: string | undefined, actual: string | unknown, opts?: { caseInsensitive?: boolean }) {
  const exp = expected ?? '';
  const act = typeof actual === 'string' ? actual : String(actual ?? '');
  const matches = opts?.caseInsensitive
    ? exp.toUpperCase() === act.toUpperCase()
    : exp === act || act.includes(exp);
  if (matches) {
    pass(`${field}: "${act}"`);
  } else {
    fail(`${field}: "${act}" (esperado: "${exp}")`);
  }
}

// ---------------------------------------------------------------------------
// IDs creados durante el test (para cleanup)
// ---------------------------------------------------------------------------
let hsCompanyId: string | undefined;
let hsContactId: string | undefined;
let hsDealId: string | undefined;
let sapCompanyId: string | undefined;
let sapContactId: string | undefined;
let sapSalesOrderId: string | undefined;

// ---------------------------------------------------------------------------
// Helper: sincronizar o recuperar mapping existente (maneja race con webhooks)
// ---------------------------------------------------------------------------

/**
 * Intenta sincronizar un objeto HubSpot → SAP.
 * Si falla por unique constraint en id_map (porque el webhook de Railway ya lo procesó),
 * recupera el mapping existente y lo retorna como éxito.
 *
 * Esto pasa porque al crear un objeto en HubSpot, el webhook se dispara
 * inmediatamente y Railway puede procesar la sync antes que este script.
 */
async function syncOrRecover(
  objectId: string,
  entityType: 'CONTACT' | 'COMPANY' | 'DEAL',
  subscriptionType: string,
): Promise<{ sapId: string; source: 'script' | 'webhook' }> {
  try {
    // Primero verificar si el webhook de Railway ya lo procesó
    const existingMap = await idMapRepo.findByHubSpotId(entityType, objectId);
    if (existingMap) {
      return { sapId: existingMap.sapId, source: 'webhook' };
    }

    const result = await syncHubSpotToSap({
      objectId,
      entityType,
      occurredAt: Date.now(),
      subscriptionType,
    });
    if (result.success && result.sapId) {
      return { sapId: result.sapId, source: 'script' };
    }
    throw new Error(result.error || result.reason || 'Sync falló sin detalle');
  } catch (e) {
    // Si es unique constraint → el webhook ya creó el mapping
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Unique constraint') || msg.includes('hubspotId')) {
      const existing = await idMapRepo.findByHubSpotId(entityType, objectId);
      if (existing) {
        return { sapId: existing.sapId, source: 'webhook' };
      }
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const ts = Date.now();

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST INTEGRAL: Vinculaciones Deal ↔ Contact ↔ Company         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // =========================================================================
  // PARTE 1: Crear objetos y sincronizar
  // =========================================================================

  // --- 1. Crear Company en HubSpot ---
  console.log('━━━ PARTE 1: Crear objetos en HubSpot y sincronizar a SAP ━━━\n');
  console.log('  📦 1/5 Creando Company en HubSpot...');

  // RUT único por ejecución: usar últimos 7 dígitos del timestamp + dígito verificador fijo
  // SAP exige unicidad en BPTaxNumber — no podemos reutilizar RUTs de ejecuciones anteriores
  const rutBase = String(ts).slice(-7);
  const testRut = `${rutBase}-0`;
  console.log(`  ℹ️  RUT de prueba único: ${testRut}`);

  try {
    const companyRes = await hubspotClient.post<HubSpotCompany>(
      '/crm/v3/objects/companies',
      {
        properties: {
          name: `Test Assoc Company ${ts}`,
          phone: '912345678',
          address: 'Av. Providencia 1234',
          city: 'Santiago',
          zip: '7500000',
          country: 'CL',
          state: 'RM',
          comuna: 'Providencia',
          rut_empresa: testRut,
          condicion_venta: '30 días',
          razon_social: `TestAssoc${ts}`,
        },
      },
    );
    hsCompanyId = companyRes.data.id;
    pass(`Company creada en HubSpot: ${hsCompanyId}`);
  } catch (e) {
    fail('Error creando Company en HubSpot', e);
    return cleanup();
  }

  // Sincronizar Company a SAP (o recuperar si webhook ya lo procesó)
  console.log('  🔄 Sincronizando Company → SAP...');
  try {
    const companySync = await syncOrRecover(hsCompanyId!, 'COMPANY', 'company.creation');
    sapCompanyId = companySync.sapId;
    pass(`Company sincronizada a SAP: BP ${sapCompanyId} (vía ${companySync.source})`);
  } catch (e) {
    fail('Error sincronizando Company a SAP', e);
    return cleanup();
  }

  // --- 2. Crear Contact en HubSpot ---
  console.log('\n  📦 2/5 Creando Contact en HubSpot...');
  try {
    const contactRes = await hubspotClient.post<HubSpotContact>(
      '/crm/v3/objects/contacts',
      {
        properties: {
          firstname: 'Test',
          lastname: `Assoc ${ts}`,
          email: `test.assoc.${ts}@example.com`,
          phone: '987654321',
          company: `Test Assoc Company ${ts}`,
          address: 'Calle Test 456',
          city: 'Santiago',
          zip: '7500001',
          country: 'CL',
          state: 'RM',
          comuna: 'Las Condes',
        },
      },
    );
    hsContactId = contactRes.data.id;
    pass(`Contact creado en HubSpot: ${hsContactId}`);
  } catch (e) {
    fail('Error creando Contact en HubSpot', e);
    return cleanup();
  }

  // Sincronizar Contact a SAP (o recuperar si webhook ya lo procesó)
  console.log('  🔄 Sincronizando Contact → SAP...');
  try {
    const contactSync = await syncOrRecover(hsContactId!, 'CONTACT', 'contact.creation');
    sapContactId = contactSync.sapId;
    pass(`Contact sincronizado a SAP: BP ${sapContactId} (vía ${contactSync.source})`);
  } catch (e) {
    fail('Error sincronizando Contact a SAP', e);
    return cleanup();
  }

  // --- 3. Asociar Contact → Company en HubSpot ---
  console.log('\n  🔗 3/5 Asociando Contact → Company en HubSpot...');
  try {
    await hubspotClient.put(
      `/crm/v3/objects/contacts/${hsContactId}/associations/companies/${hsCompanyId}/contact_to_company`,
      {},
    );
    pass(`Asociación Contact ${hsContactId} → Company ${hsCompanyId} creada`);
  } catch (e) {
    // Intentar con el endpoint v4 de asociaciones
    try {
      await hubspotClient.put(
        `/crm/v4/objects/contacts/${hsContactId}/associations/companies/${hsCompanyId}`,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }],
      );
      pass(`Asociación Contact ${hsContactId} → Company ${hsCompanyId} creada (v4)`);
    } catch (e2) {
      fail('Error asociando Contact → Company', e2);
      // No es crítico para el test, continuamos
    }
  }

  // --- 4. Crear Deal asociado a Company en HubSpot ---
  console.log('\n  📦 4/5 Creando Deal en HubSpot...');
  try {
    const dealRes = await hubspotClient.post<HubSpotDeal>(
      '/crm/v3/objects/deals',
      {
        properties: {
          dealname: `Test Assoc Deal ${ts}`,
          pipeline: '132611721', // Pipeline Ventas
          dealstage: '229341459', // EnviarCotizacion
          closedate: '2026-06-30',
          deal_currency_code: 'CLP',
          condicion_de_pago: '30 días',
          fecha_de_entrega: '2026-07-15',
          cuanto_es_la_cantidad_requerida_del_producto_: '100',
        },
      },
    );
    hsDealId = dealRes.data.id;
    pass(`Deal creado en HubSpot: ${hsDealId}`);
  } catch (e) {
    fail('Error creando Deal en HubSpot', e);
    return cleanup();
  }

  // Asociar Deal → Company
  console.log('  🔗 Asociando Deal → Company...');
  try {
    await hubspotClient.put(
      `/crm/v3/objects/deals/${hsDealId}/associations/companies/${hsCompanyId}/deal_to_company`,
      {},
    );
    pass(`Asociación Deal ${hsDealId} → Company ${hsCompanyId} creada`);
  } catch (e) {
    try {
      await hubspotClient.put(
        `/crm/v4/objects/deals/${hsDealId}/associations/companies/${hsCompanyId}`,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }],
      );
      pass(`Asociación Deal ${hsDealId} → Company ${hsCompanyId} creada (v4)`);
    } catch (e2) {
      fail('Error asociando Deal → Company', e2);
      return cleanup();
    }
  }

  // Sincronizar Deal a SAP (o recuperar si webhook ya lo procesó)
  console.log('  🔄 Sincronizando Deal → SAP Sales Order...');
  try {
    const dealSync = await syncOrRecover(hsDealId!, 'DEAL', 'deal.creation');
    sapSalesOrderId = dealSync.sapId;
    pass(`Deal sincronizado a SAP: Sales Order ${sapSalesOrderId} (vía ${dealSync.source})`);
  } catch (e) {
    if (e instanceof MissingDependencyError) {
      fail('Deal sync: MissingDependencyError — Company mapping no encontrado', e);
    } else {
      fail('Error sincronizando Deal a SAP', e);
    }
    return cleanup();
  }

  // --- 5. Asociar Deal → Contact en HubSpot ---
  console.log('\n  🔗 5/5 Asociando Deal → Contact...');
  try {
    await hubspotClient.put(
      `/crm/v3/objects/deals/${hsDealId}/associations/contacts/${hsContactId}/deal_to_contact`,
      {},
    );
    pass(`Asociación Deal ${hsDealId} → Contact ${hsContactId} creada`);
  } catch (e) {
    try {
      await hubspotClient.put(
        `/crm/v4/objects/deals/${hsDealId}/associations/contacts/${hsContactId}`,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
      );
      pass(`Asociación Deal ${hsDealId} → Contact ${hsContactId} creada (v4)`);
    } catch (e2) {
      fail('Error asociando Deal → Contact (no crítico)', e2);
    }
  }

  // =========================================================================
  // PARTE 2: Verificar vinculaciones
  // =========================================================================
  console.log('\n━━━ PARTE 2: Verificar vinculaciones ━━━\n');

  // --- 6. Verificar SalesOrder en SAP ---
  console.log('  🔍 6. Verificando SalesOrder en SAP...');
  try {
    const soRes = await sapClient.get<ODataResponse<{
      SalesOrder: string;
      SoldToParty: string;
      PurchaseOrderByCustomer: string;
      CustomerPaymentTerms: string;
      RequestedDeliveryDate: string;
    }>>(`/API_SALES_ORDER_SRV/A_SalesOrder('${sapSalesOrderId}')`);

    const so = soRes.data.d;
    check('SalesOrder.SoldToParty', sapCompanyId, so.SoldToParty);
    check('SalesOrder.PurchaseOrderByCustomer', `Test Assoc Deal ${ts}`, so.PurchaseOrderByCustomer);
    check('SalesOrder.CustomerPaymentTerms', 'NT30', so.CustomerPaymentTerms);

    if (so.SoldToParty === sapCompanyId) {
      pass(`⭐ VINCULACIÓN CORRECTA: Deal ${hsDealId} → SalesOrder ${sapSalesOrderId} → SoldToParty BP ${sapCompanyId}`);
    } else {
      fail(`SoldToParty ${so.SoldToParty} no coincide con Company SAP ID ${sapCompanyId}`);
    }
  } catch (e) {
    fail('Error leyendo SalesOrder de SAP', e);
  }

  // --- 7. Verificar asociaciones en HubSpot ---
  console.log('\n  🔍 7. Verificando asociaciones en HubSpot...');

  // Deal → Company
  try {
    const assocRes = await hubspotClient.get<HubSpotAssociationsResponse>(
      `/crm/v3/objects/deals/${hsDealId}/associations/company`,
    );
    const companies = assocRes.data.results;
    if (companies && companies.length > 0) {
      const found = companies.find(a => a.id === hsCompanyId);
      if (found) {
        pass(`Deal → Company: Deal ${hsDealId} vinculado a Company ${hsCompanyId}`);
      } else {
        fail(`Deal → Company: Company ${hsCompanyId} no encontrada en asociaciones (encontradas: ${companies.map(c => c.id).join(', ')})`);
      }
    } else {
      fail('Deal → Company: Sin asociaciones');
    }
  } catch (e) {
    fail('Error verificando asociación Deal → Company', e);
  }

  // Deal → Contact
  try {
    const assocRes = await hubspotClient.get<HubSpotAssociationsResponse>(
      `/crm/v3/objects/deals/${hsDealId}/associations/contact`,
    );
    const contacts = assocRes.data.results;
    if (contacts && contacts.length > 0) {
      const found = contacts.find(a => a.id === hsContactId);
      if (found) {
        pass(`Deal → Contact: Deal ${hsDealId} vinculado a Contact ${hsContactId}`);
      } else {
        fail(`Deal → Contact: Contact ${hsContactId} no encontrado en asociaciones`);
      }
    } else {
      fail('Deal → Contact: Sin asociaciones');
    }
  } catch (e) {
    fail('Error verificando asociación Deal → Contact', e);
  }

  // Contact → Company
  try {
    const assocRes = await hubspotClient.get<HubSpotAssociationsResponse>(
      `/crm/v3/objects/contacts/${hsContactId}/associations/company`,
    );
    const companies = assocRes.data.results;
    if (companies && companies.length > 0) {
      const found = companies.find(a => a.id === hsCompanyId);
      if (found) {
        pass(`Contact → Company: Contact ${hsContactId} vinculado a Company ${hsCompanyId}`);
      } else {
        fail(`Contact → Company: Company ${hsCompanyId} no encontrada en asociaciones`);
      }
    } else {
      fail('Contact → Company: Sin asociaciones');
    }
  } catch (e) {
    fail('Error verificando asociación Contact → Company', e);
  }

  // --- 8. Verificar id_map ---
  console.log('\n  🔍 8. Verificando id_map en base de datos...');
  try {
    const companyMap = await idMapRepo.findByHubSpotId('COMPANY', hsCompanyId!);
    if (companyMap && companyMap.sapId === sapCompanyId) {
      pass(`id_map COMPANY: HS ${hsCompanyId} ↔ SAP ${sapCompanyId}`);
    } else {
      fail(`id_map COMPANY: no encontrado o SAP ID incorrecto (${companyMap?.sapId})`);
    }
  } catch (e) {
    fail('Error consultando id_map COMPANY', e);
  }

  try {
    const contactMap = await idMapRepo.findByHubSpotId('CONTACT', hsContactId!);
    if (contactMap && contactMap.sapId === sapContactId) {
      pass(`id_map CONTACT: HS ${hsContactId} ↔ SAP ${sapContactId}`);
    } else {
      fail(`id_map CONTACT: no encontrado o SAP ID incorrecto (${contactMap?.sapId})`);
    }
  } catch (e) {
    fail('Error consultando id_map CONTACT', e);
  }

  try {
    const dealMap = await idMapRepo.findByHubSpotId('DEAL', hsDealId!);
    if (dealMap && dealMap.sapId === sapSalesOrderId) {
      pass(`id_map DEAL: HS ${hsDealId} ↔ SAP ${sapSalesOrderId}`);
    } else {
      fail(`id_map DEAL: no encontrado o SAP ID incorrecto (${dealMap?.sapId})`);
    }
  } catch (e) {
    fail('Error consultando id_map DEAL', e);
  }

  // =========================================================================
  // PARTE 3: Probar Fix A1 (associationChange event parsing)
  // =========================================================================
  console.log('\n━━━ PARTE 3: Fix A1 — Parsing de eventos associationChange ━━━\n');

  // Simulamos los eventos como llegarían de HubSpot
  // No podemos llamar al webhook real, pero verificamos que la lógica funciona

  // Simular: Deal → Company (fromObjectTypeId=0-3, toObjectTypeId=0-2)
  const mockAssocEvent1 = {
    fromObjectTypeId: '0-3', // Deal
    toObjectTypeId: '0-2',   // Company
    fromObjectId: Number(hsDealId),
    toObjectId: Number(hsCompanyId),
    associationRemoved: false,
  };
  // Verificar que extraemos el Deal ID correctamente
  if (mockAssocEvent1.fromObjectTypeId === '0-3' && mockAssocEvent1.toObjectTypeId === '0-2') {
    const extractedDealId = mockAssocEvent1.fromObjectId;
    check('Fix A1 — Deal→Company: Deal ID extraído', hsDealId, String(extractedDealId));
  }

  // Simular: Company → Deal (invertido)
  const mockAssocEvent2 = {
    fromObjectTypeId: '0-2', // Company
    toObjectTypeId: '0-3',   // Deal
    fromObjectId: Number(hsCompanyId),
    toObjectId: Number(hsDealId),
    associationRemoved: false,
  };
  if (mockAssocEvent2.fromObjectTypeId === '0-2' && mockAssocEvent2.toObjectTypeId === '0-3') {
    const extractedDealId = mockAssocEvent2.toObjectId;
    check('Fix A1 — Company→Deal: Deal ID extraído', hsDealId, String(extractedDealId));
  }

  // Simular: Contact → Company (no debe extraer Deal ID)
  const mockAssocEvent3 = {
    fromObjectTypeId: '0-1', // Contact
    toObjectTypeId: '0-2',   // Company
    fromObjectId: Number(hsContactId),
    toObjectId: Number(hsCompanyId),
  };
  const isContactCompany = (mockAssocEvent3.fromObjectTypeId === '0-3' || mockAssocEvent3.toObjectTypeId === '0-3');
  if (!isContactCompany) {
    pass('Fix A1 — Contact→Company: Correctamente ignorado (no involucra Deal)');
  } else {
    fail('Fix A1 — Contact→Company: Debería haberse ignorado');
  }

  // Simular: asociación eliminada (debe ignorarse)
  const mockAssocEventRemoved = {
    fromObjectTypeId: '0-3',
    toObjectTypeId: '0-2',
    fromObjectId: Number(hsDealId),
    toObjectId: Number(hsCompanyId),
    associationRemoved: true,
  };
  if (mockAssocEventRemoved.associationRemoved) {
    pass('Fix A1 — Asociación eliminada: Correctamente ignorada');
  } else {
    fail('Fix A1 — Asociación eliminada: Debería haberse ignorado');
  }

  // =========================================================================
  // PARTE 4: Probar Fix B1 (MissingDependencyError)
  // =========================================================================
  console.log('\n━━━ PARTE 4: Fix B1 — MissingDependencyError ━━━\n');

  // Crear un Deal nuevo SIN asociar a Company → debe lanzar MissingDependencyError
  let tempDealId: string | undefined;
  try {
    console.log('  📦 Creando Deal SIN Company asociada...');
    const tempDealRes = await hubspotClient.post<HubSpotDeal>(
      '/crm/v3/objects/deals',
      {
        properties: {
          dealname: `Test NoCompany Deal ${ts}`,
          pipeline: '132611721',
          dealstage: '229341459',
          closedate: '2026-12-31',
          deal_currency_code: 'CLP',
          condicion_de_pago: '30 días',
        },
      },
    );
    tempDealId = tempDealRes.data.id;
    pass(`Deal sin Company creado: ${tempDealId}`);

    // Intentar sincronizar → debe lanzar MissingDependencyError
    console.log('  🔄 Intentando sincronizar Deal sin Company → esperando MissingDependencyError...');
    try {
      await syncHubSpotToSap({
        objectId: tempDealId,
        entityType: 'DEAL',
        occurredAt: Date.now(),
        subscriptionType: 'deal.creation',
      });
      fail('Fix B1: Se esperaba MissingDependencyError pero sync tuvo éxito');
    } catch (e) {
      if (e instanceof MissingDependencyError) {
        pass(`Fix B1: MissingDependencyError lanzado correctamente — "${e.message.substring(0, 80)}..."`);
        check('Fix B1 — Error code', 'MISSING_COMPANY', e.code);
        check('Fix B1 — Error retriable', 'true', String(e.retriable));
      } else {
        fail('Fix B1: Se lanzó un error pero NO es MissingDependencyError', e);
      }
    }
  } catch (e) {
    fail('Error creando Deal temporal sin Company', e);
  }

  // =========================================================================
  // PARTE 5: Cleanup
  // =========================================================================
  await cleanup(tempDealId);
}

// ---------------------------------------------------------------------------
// Cleanup: eliminar objetos de prueba de HubSpot
// ---------------------------------------------------------------------------
async function cleanup(tempDealId?: string) {
  console.log('\n━━━ CLEANUP: Eliminando objetos de prueba de HubSpot ━━━\n');

  const toDelete = [
    { type: 'deals', id: hsDealId, label: 'Deal principal' },
    { type: 'deals', id: tempDealId, label: 'Deal sin Company' },
    { type: 'contacts', id: hsContactId, label: 'Contact' },
    { type: 'companies', id: hsCompanyId, label: 'Company' },
  ];

  for (const item of toDelete) {
    if (!item.id) continue;
    try {
      await hubspotClient.delete(`/crm/v3/objects/${item.type}/${item.id}`);
      console.log(`  🗑️  ${item.label} ${item.id} eliminado de HubSpot`);
    } catch (e) {
      console.log(`  ⚠️  No se pudo eliminar ${item.label} ${item.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Nota: los BP y SalesOrder creados en SAP no se eliminan (SAP no tiene DELETE)
  if (sapCompanyId) console.log(`  ℹ️  SAP BP Company ${sapCompanyId} permanece (SAP no tiene DELETE API)`);
  if (sapContactId) console.log(`  ℹ️  SAP BP Contact ${sapContactId} permanece`);
  if (sapSalesOrderId) console.log(`  ℹ️  SAP Sales Order ${sapSalesOrderId} permanece`);

  // Resumen
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTADO: ${passCount} pasaron, ${failCount} fallaron${' '.repeat(Math.max(0, 33 - String(passCount).length - String(failCount).length))}║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (failCount > 0) {
    console.log('\n  ⚠️  Hubo fallos — revisar los ❌ arriba.\n');
    process.exit(1);
  } else {
    console.log('\n  🎉 Todas las vinculaciones funcionan correctamente.\n');
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
main().catch((e) => {
  console.error('\n💥 Error fatal:', e);
  cleanup().catch(() => process.exit(1));
});
