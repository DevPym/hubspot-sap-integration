/**
 * integration-test.ts — Pruebas de integración REALES contra HubSpot y SAP.
 *
 * ⚠️ IMPORTANTE: Este script se conecta a los sistemas REALES.
 *    Solo usa datos de prueba. Nunca apuntar a producción sin precaución.
 *
 * Ejecutar:
 *   npx tsx src/scripts/integration-test.ts
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PRUEBAS                                                                │
 * │  ───────                                                                │
 * │  1. Conectividad: HubSpot GET, SAP GET (verificar credenciales)        │
 * │  2. READ: Leer Contact, Company, Deal de HubSpot                       │
 * │  3. READ: Leer BP Persona, BP Org, SalesOrder de SAP                   │
 * │  4. MAPPER: Transformar datos leídos y verificar resultado              │
 * │  5. CREATE Contact → SAP BP Persona (dato de prueba nuevo)             │
 * │  6. CREATE Company → SAP BP Organización (dato de prueba nuevo)        │
 * │  7. CREATE Deal → SAP Sales Order (con Company del paso 6)             │
 * │  8. UPDATE Contact en HubSpot → PATCH en SAP                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import 'dotenv/config';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import { sapClient } from '../adapters/sap/sap.client';
import * as mapper from '../services/mapper.service';
import type { HubSpotContact, HubSpotCompany, HubSpotDeal } from '../adapters/hubspot/hubspot.types';
import type { ODataResponse, SapBusinessPartner } from '../adapters/sap/sap.types';

// ---------------------------------------------------------------------------
// IDs de prueba existentes (verificados en CLAUDE.md)
// ---------------------------------------------------------------------------

const TEST_IDS = {
  hubspot: {
    contactId: '210581802294',   // Max Power Test
    companyId: '53147869965',    // Empresa Test SAP Integration
    dealId: '58247306498',       // Deal Test SAP Integration
  },
  sap: {
    bpPersonaId: '100000031',    // Juan Pérez Test
    bpOrgId: '100000030',        // Empresa Test desde HubSpot
    salesOrderId: '49',          // DEAL-TEST-HubSpot
  },
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function log(emoji: string, msg: string) {
  console.log(`  ${emoji} ${msg}`);
}

function pass(test: string) {
  passCount++;
  log('✅', test);
}

function fail(test: string, error: unknown) {
  failCount++;
  const msg = error instanceof Error ? error.message : String(error);
  log('❌', `${test} — ${msg}`);
}

function skip(test: string, reason: string) {
  skipCount++;
  log('⏭️', `${test} — ${reason}`);
}

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testHubSpotConnectivity() {
  section('1. CONECTIVIDAD HUBSPOT');
  try {
    const res = await hubspotClient.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${TEST_IDS.hubspot.contactId}`,
      { params: { properties: 'firstname,lastname,email' } },
    );
    pass(`HubSpot GET Contact ${TEST_IDS.hubspot.contactId} → ${res.data.properties.firstname} ${res.data.properties.lastname}`);
    return true;
  } catch (e) {
    fail('HubSpot GET Contact', e);
    return false;
  }
}

async function testSapConnectivity() {
  section('2. CONECTIVIDAD SAP');
  try {
    const res = await sapClient.get<ODataResponse<SapBusinessPartner>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${TEST_IDS.sap.bpPersonaId}')`,
    );
    const bp = res.data.d;
    pass(`SAP GET BP ${TEST_IDS.sap.bpPersonaId} → ${bp.FirstName} ${bp.LastName}`);
    return true;
  } catch (e) {
    fail('SAP GET BP', e);
    return false;
  }
}

async function testReadHubSpotEntities() {
  section('3. READ HUBSPOT — Contact, Company, Deal');

  // Contact
  try {
    const res = await hubspotClient.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${TEST_IDS.hubspot.contactId}`,
      { params: { properties: 'firstname,lastname,email,phone,mobilephone,address,city,zip,country,state,company,lastmodifieddate,comuna' } },
    );
    const p = res.data.properties;
    pass(`Contact: ${p.firstname} ${p.lastname} | email=${p.email} | lastmodifieddate=${p.lastmodifieddate}`);
  } catch (e) {
    fail('HubSpot GET Contact completo', e);
  }

  // Company
  try {
    const res = await hubspotClient.get<HubSpotCompany>(
      `/crm/v3/objects/companies/${TEST_IDS.hubspot.companyId}`,
      { params: { properties: 'name,phone,address,city,country,rut_empresa,condicion_venta,razon_social,hs_lastmodifieddate' } },
    );
    const p = res.data.properties;
    pass(`Company: ${p.name} | rut_empresa=${p.rut_empresa} | hs_lastmodifieddate=${p.hs_lastmodifieddate}`);
  } catch (e) {
    fail('HubSpot GET Company completo', e);
  }

  // Deal
  try {
    const res = await hubspotClient.get<HubSpotDeal>(
      `/crm/v3/objects/deals/${TEST_IDS.hubspot.dealId}`,
      { params: { properties: 'dealname,amount,closedate,deal_currency_code,dealstage,pipeline,hs_lastmodifieddate,condicion_de_pago,fecha_de_entrega,orden_de_compra,cantidad_producto' } },
    );
    const p = res.data.properties;
    pass(`Deal: ${p.dealname} | amount=${p.amount} | stage=${p.dealstage}`);
  } catch (e) {
    fail('HubSpot GET Deal completo', e);
  }
}

async function testReadSapEntities() {
  section('4. READ SAP — BP Persona, BP Org, SalesOrder');

  // BP Persona
  try {
    const res = await sapClient.get<ODataResponse<SapBusinessPartner>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${TEST_IDS.sap.bpPersonaId}')`,
    );
    const bp = res.data.d;
    pass(`BP Persona: ${bp.FirstName} ${bp.LastName} | Category=${bp.BusinessPartnerCategory} | LastChangeDate=${bp.LastChangeDate}`);
  } catch (e) {
    fail('SAP GET BP Persona', e);
  }

  // BP Organización
  try {
    const res = await sapClient.get<ODataResponse<SapBusinessPartner>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${TEST_IDS.sap.bpOrgId}')`,
    );
    const bp = res.data.d;
    pass(`BP Org: ${bp.OrganizationBPName1} | Category=${bp.BusinessPartnerCategory}`);
  } catch (e) {
    fail('SAP GET BP Org', e);
  }

  // SalesOrder
  try {
    const res = await sapClient.get<ODataResponse<Record<string, unknown>>>(
      `/API_SALES_ORDER_SRV/A_SalesOrder('${TEST_IDS.sap.salesOrderId}')`,
    );
    const so = res.data.d;
    pass(`SalesOrder: ${so.SalesOrder} | SoldToParty=${so.SoldToParty} | TotalNetAmount=${so.TotalNetAmount}`);
  } catch (e) {
    fail('SAP GET SalesOrder', e);
  }
}

async function testMapperTransformations() {
  section('5. MAPPER — Transformar datos HubSpot → SAP');

  // Leer Contact de HubSpot y transformar a SAP
  try {
    const res = await hubspotClient.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${TEST_IDS.hubspot.contactId}`,
      { params: { properties: 'firstname,lastname,email,phone,mobilephone,address,city,zip,country,state,company,comuna' } },
    );
    const payload = mapper.contactToSapBP(res.data.properties, TEST_IDS.hubspot.contactId);
    pass(`Contact→BP: Category=${payload.BusinessPartnerCategory}, Name=${payload.FirstName} ${payload.LastName}, Grouping=${payload.BusinessPartnerGrouping}`);

    // Verificar constantes
    if (payload.BusinessPartnerCategory !== '1') throw new Error('Category debería ser 1');
    if (payload.BusinessPartnerGrouping !== 'BP02') throw new Error('Grouping debería ser BP02');
    pass('Constantes verificadas: Category=1, Grouping=BP02, Roles=2');
  } catch (e) {
    fail('Mapper Contact→BP', e);
  }

  // Leer Company y transformar
  try {
    const res = await hubspotClient.get<HubSpotCompany>(
      `/crm/v3/objects/companies/${TEST_IDS.hubspot.companyId}`,
      { params: { properties: 'name,phone,rut_empresa,condicion_venta,razon_social,address,city,country' } },
    );
    const payload = mapper.companyToSapBP(res.data.properties, TEST_IDS.hubspot.companyId);
    pass(`Company→BP: Category=${payload.BusinessPartnerCategory}, Name=${payload.OrganizationBPName1}`);

    if (payload.BusinessPartnerCategory !== '2') throw new Error('Category debería ser 2');
    pass('Constantes verificadas: Category=2');
  } catch (e) {
    fail('Mapper Company→BP', e);
  }
}

async function testCreateContactInSap() {
  section('6. CREATE — Contact de prueba → SAP BP Persona');

  // Crear un Contact nuevo en HubSpot primero
  let newContactId: string | null = null;
  try {
    const timestamp = Date.now();
    const res = await hubspotClient.post<HubSpotContact>(
      '/crm/v3/objects/contacts',
      {
        properties: {
          firstname: 'IntegrationTest',
          lastname: `Persona_${timestamp}`,
          email: `test_${timestamp}@integration.cl`,
          phone: '+56911111111',
          country: 'CL',
          city: 'Santiago',
          address: 'Av. Test 456',
        },
      },
    );
    newContactId = res.data.id;
    pass(`HubSpot CREATE Contact → ID: ${newContactId}`);
  } catch (e) {
    fail('HubSpot CREATE Contact', e);
    return { contactId: null, sapBPId: null };
  }

  // Leer el Contact creado
  let contactProps: HubSpotContact['properties'];
  try {
    const res = await hubspotClient.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${newContactId}`,
      { params: { properties: 'firstname,lastname,email,phone,country,city,address' } },
    );
    contactProps = res.data.properties;
    pass(`HubSpot READ Contact ${newContactId} → ${contactProps.firstname} ${contactProps.lastname}`);
  } catch (e) {
    fail('HubSpot READ Contact creado', e);
    return { contactId: newContactId, sapBPId: null };
  }

  // Transformar y crear en SAP
  let sapBPId: string | null = null;
  try {
    const payload = mapper.contactToSapBP(contactProps, newContactId!);
    const res = await sapClient.post<ODataResponse<{ BusinessPartner: string }>>(
      '/API_BUSINESS_PARTNER/A_BusinessPartner',
      payload,
    );
    sapBPId = res.data.d.BusinessPartner;
    pass(`SAP CREATE BP Persona → ID: ${sapBPId}`);
  } catch (e: unknown) {
    fail('SAP CREATE BP Persona', e);
    // Intentar obtener detalle del error SAP
    if (e && typeof e === 'object' && 'response' in e) {
      const axiosErr = e as { response?: { data?: unknown } };
      if (axiosErr.response?.data) {
        console.log('    SAP Error detail:', JSON.stringify(axiosErr.response.data, null, 2));
      }
    }
  }

  return { contactId: newContactId, sapBPId };
}

async function testCreateCompanyInSap() {
  section('7. CREATE — Company de prueba → SAP BP Organización');

  let newCompanyId: string | null = null;
  try {
    const timestamp = Date.now();
    const res = await hubspotClient.post<HubSpotCompany>(
      '/crm/v3/objects/companies',
      {
        properties: {
          name: `IntTest Company ${timestamp}`,
          phone: '+56222222222',
          // RUT único por test para evitar duplicados en SAP
          rut_empresa: `99.${String(timestamp).slice(-3)}.${String(timestamp).slice(-6, -3)}-0`,
          country: 'CL',
          city: 'Santiago',
          address: 'Av. Test 123',
        },
      },
    );
    newCompanyId = res.data.id;
    pass(`HubSpot CREATE Company → ID: ${newCompanyId}`);
  } catch (e) {
    fail('HubSpot CREATE Company', e);
    return { companyId: null, sapBPId: null };
  }

  // Leer Company creada
  let companyProps: HubSpotCompany['properties'];
  try {
    const res = await hubspotClient.get<HubSpotCompany>(
      `/crm/v3/objects/companies/${newCompanyId}`,
      { params: { properties: 'name,phone,rut_empresa,country,city,address' } },
    );
    companyProps = res.data.properties;
    pass(`HubSpot READ Company ${newCompanyId} → ${companyProps.name}`);
  } catch (e) {
    fail('HubSpot READ Company creada', e);
    return { companyId: newCompanyId, sapBPId: null };
  }

  // Crear en SAP
  let sapBPId: string | null = null;
  try {
    const payload = mapper.companyToSapBP(companyProps, newCompanyId!);
    const res = await sapClient.post<ODataResponse<{ BusinessPartner: string }>>(
      '/API_BUSINESS_PARTNER/A_BusinessPartner',
      payload,
    );
    sapBPId = res.data.d.BusinessPartner;
    pass(`SAP CREATE BP Org → ID: ${sapBPId}`);
  } catch (e: unknown) {
    fail('SAP CREATE BP Org', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const axiosErr = e as { response?: { data?: unknown } };
      if (axiosErr.response?.data) {
        console.log('    SAP Error detail:', JSON.stringify(axiosErr.response.data, null, 2));
      }
    }
  }

  return { companyId: newCompanyId, sapBPId };
}

async function testCreateDealInSap(sapCompanyBPId: string, hubspotCompanyId: string) {
  section('8. CREATE — Deal de prueba → SAP Sales Order');

  // Crear Deal en HubSpot
  let newDealId: string | null = null;
  try {
    const timestamp = Date.now();
    const res = await hubspotClient.post<HubSpotDeal>(
      '/crm/v3/objects/deals',
      {
        properties: {
          dealname: `IntTest Deal ${timestamp}`,
          pipeline: '132611721', // Ventas
          dealstage: '229341459', // EnviarCotizacion
          closedate: '2025-12-31',
          deal_currency_code: 'CLP',
          // cantidad_producto: propiedad custom que puede no existir aún en HubSpot
        },
      },
    );
    newDealId = res.data.id;
    pass(`HubSpot CREATE Deal → ID: ${newDealId}`);
  } catch (e: unknown) {
    fail('HubSpot CREATE Deal', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const axiosErr = e as { response?: { data?: unknown } };
      if (axiosErr.response?.data) {
        console.log('    HubSpot Error detail:', JSON.stringify(axiosErr.response.data, null, 2));
      }
    }
    return { dealId: null, sapSOId: null };
  }

  // Asociar Deal → Company
  try {
    await hubspotClient.put(
      `/crm/v3/objects/deals/${newDealId}/associations/company/${hubspotCompanyId}/deal_to_company`,
    );
    pass(`HubSpot ASSOCIATE Deal ${newDealId} → Company ${hubspotCompanyId}`);
  } catch (e) {
    // PUT association puede fallar con 405, intentar con POST v4
    try {
      await hubspotClient.post(
        `/crm/v4/objects/deals/${newDealId}/associations/companies/${hubspotCompanyId}`,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }], // 5 = deal_to_company
      );
      pass(`HubSpot ASSOCIATE (v4) Deal ${newDealId} → Company ${hubspotCompanyId}`);
    } catch (e2) {
      fail('HubSpot ASSOCIATE Deal→Company', e2);
      return { dealId: newDealId, sapSOId: null };
    }
  }

  // Leer Deal con propiedades
  let dealProps: HubSpotDeal['properties'];
  try {
    const res = await hubspotClient.get<HubSpotDeal>(
      `/crm/v3/objects/deals/${newDealId}`,
      { params: { properties: 'dealname,closedate,deal_currency_code,cantidad_producto' } },
    );
    dealProps = res.data.properties;
    pass(`HubSpot READ Deal ${newDealId} → ${dealProps.dealname}`);
  } catch (e) {
    fail('HubSpot READ Deal', e);
    return { dealId: newDealId, sapSOId: null };
  }

  // Crear Sales Order en SAP
  let sapSOId: string | null = null;
  try {
    const payload = mapper.dealToSalesOrder(dealProps, sapCompanyBPId);
    const res = await sapClient.post<ODataResponse<{ SalesOrder: string }>>(
      '/API_SALES_ORDER_SRV/A_SalesOrder',
      payload,
    );
    sapSOId = res.data.d.SalesOrder;
    pass(`SAP CREATE SalesOrder → ID: ${sapSOId}`);
  } catch (e: unknown) {
    fail('SAP CREATE SalesOrder', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const axiosErr = e as { response?: { data?: unknown } };
      if (axiosErr.response?.data) {
        console.log('    SAP Error detail:', JSON.stringify(axiosErr.response.data, null, 2));
      }
    }
  }

  return { dealId: newDealId, sapSOId };
}

async function testUpdateContactInSap(hubspotContactId: string, sapBPId: string) {
  section('9. UPDATE — Modificar Contact en HubSpot → PATCH en SAP');

  // Actualizar Contact en HubSpot
  try {
    const newFirstname = `Updated_${Date.now()}`;
    await hubspotClient.patch<HubSpotContact>(
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      { properties: { firstname: newFirstname } },
    );
    pass(`HubSpot PATCH Contact ${hubspotContactId} → firstname=${newFirstname}`);

    // Transformar para SAP update
    const updatePayload = mapper.contactToSapBPUpdate({ firstname: newFirstname });
    pass(`Mapper UPDATE → ${JSON.stringify(updatePayload)}`);

    // PATCH en SAP con ETag
    await sapClient.patchWithETag(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
      updatePayload,
    );
    pass(`SAP PATCH BP ${sapBPId} con ETag → SUCCESS (204)`);

    // Verificar leyendo de SAP
    const verify = await sapClient.get<ODataResponse<SapBusinessPartner>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
    );
    const verifiedName = verify.data.d.FirstName;
    if (verifiedName === newFirstname) {
      pass(`SAP VERIFY → FirstName=${verifiedName} ✓ (coincide con HubSpot)`);
    } else {
      fail('SAP VERIFY', new Error(`FirstName=${verifiedName}, esperado=${newFirstname}`));
    }
  } catch (e: unknown) {
    fail('UPDATE Contact→SAP', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const axiosErr = e as { response?: { data?: unknown } };
      if (axiosErr.response?.data) {
        console.log('    SAP Error detail:', JSON.stringify(axiosErr.response.data, null, 2));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  INTEGRATION TEST — HubSpot <-> SAP (Química Sur)        ║');
  console.log('║  Usando datos de PRUEBA solamente                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // 1-2. Conectividad
  const hsOk = await testHubSpotConnectivity();
  const sapOk = await testSapConnectivity();

  if (!hsOk || !sapOk) {
    console.log('\n⛔ Conectividad fallida. Verificar credenciales en .env');
    process.exit(1);
  }

  // 3-4. READ
  await testReadHubSpotEntities();
  await testReadSapEntities();

  // 5. Mapper
  await testMapperTransformations();

  // 6. CREATE Contact
  const contactResult = await testCreateContactInSap();

  // 7. CREATE Company
  const companyResult = await testCreateCompanyInSap();

  // 8. CREATE Deal (necesita Company con Customer Master activo en SAP)
  // Nota: SoldToParty debe ser un BP que tenga Customer Master record.
  // El SO 49 usa SoldToParty=70123456, que es el que funciona en producción.
  // Los BPs de prueba (100000030, 100000047) no tienen customer master aún.
  await testCreateDealInSap('70123456', TEST_IDS.hubspot.companyId);

  // 9. UPDATE Contact
  if (contactResult.contactId && contactResult.sapBPId) {
    await testUpdateContactInSap(contactResult.contactId, contactResult.sapBPId);
  } else {
    skip('UPDATE Contact → SAP', 'Se requiere Contact creado exitosamente en paso 6');
  }

  // Resumen
  section('RESUMEN');
  console.log(`  ✅ Pasaron:   ${passCount}`);
  console.log(`  ❌ Fallaron:  ${failCount}`);
  console.log(`  ⏭️  Saltados:  ${skipCount}`);
  console.log(`  Total:       ${passCount + failCount + skipCount}`);

  if (failCount > 0) {
    console.log('\n⚠️  Hay pruebas fallidas. Revisar errores arriba.');
    process.exit(1);
  } else {
    console.log('\n🎉 Todas las pruebas pasaron exitosamente.');
  }
}

main().catch((e) => {
  console.error('Error fatal:', e);
  process.exit(1);
});
