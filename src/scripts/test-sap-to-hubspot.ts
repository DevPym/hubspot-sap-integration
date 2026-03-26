/**
 * Prueba SAP → HubSpot: verificar que cambios en SAP se reflejan en HubSpot.
 *
 * FLUJO:
 *   1. Usar un Contact de prueba que ya tenga mapping en id_map
 *      (creado por webhook previo: Max Power Test → BP 100000055)
 *   2. Modificar directamente en SAP (PATCH FirstName)
 *   3. Verificar que el poller de Railway detecta el cambio y actualiza HubSpot
 *      (esto requiere esperar al ciclo del poller en Railway, ~5 min)
 *
 * ALTERNATIVA RÁPIDA (sin esperar poller):
 *   - Simular lo que hace el poller: leer de SAP → transformar → PATCH HubSpot
 *   - Esto prueba el mapper inverso y el flujo completo sin depender del timer
 *
 * Uso: npx tsx src/scripts/test-sap-to-hubspot.ts
 */
import 'dotenv/config';
import { sapClient } from '../adapters/sap/sap.client';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import * as mapper from '../services/mapper.service';
import type { HubSpotContact, HubSpotCompany, HubSpotDeal } from '../adapters/hubspot/hubspot.types';
import type {
  ODataResponse,
  ODataListResponse,
  SapBusinessPartner,
  SapBPAddress,
  SapSalesOrder,
} from '../adapters/sap/sap.types';

// ---------------------------------------------------------------------------
// IDs de prueba con mapping existente (creados en pruebas anteriores)
// ---------------------------------------------------------------------------

/**
 * ⚠️ IMPORTANTE: Estos IDs deben tener registro en id_map de Railway.
 * Si no los tienes, usa los datos de "Max Power Test" que fue creado
 * por webhook y tiene mapping.
 *
 * CONTACTO: Max Power Test
 *   HubSpot ID: 210581802294
 *   SAP BP ID:  100000055 (o el que tenga en id_map)
 *
 * Si no hay mapping, el script simulará el flujo completo igualmente.
 */
const TEST_DATA = {
  contact: {
    hubspotId: '210581802294',   // Max Power Test
    sapBPId: '100000055',
  },
  // Company y Deal: usar los de prueba existentes
  company: {
    hubspotId: '53147869965',    // Empresa Test SAP Integration
    sapBPId: '100000030',
  },
  deal: {
    hubspotId: '58247306498',    // Deal Test SAP Integration
    sapSOId: '49',
  },
};

let passCount = 0;
let failCount = 0;

function pass(msg: string) { passCount++; console.log(`  ✅ ${msg}`); }
function fail(msg: string, e?: unknown) {
  failCount++;
  const detail = e instanceof Error ? e.message : e ? String(e) : '';
  console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

// ---------------------------------------------------------------------------
// TEST 1: SAP → HubSpot Contact (simulando poller)
// ---------------------------------------------------------------------------

async function testSapToHubSpotContact() {
  section('TEST 1: SAP BP Persona → HubSpot Contact');

  const { hubspotId, sapBPId } = TEST_DATA.contact;
  const ts = Date.now();
  const newFirstName = `FromSAP_${ts}`;

  // Paso 1: Leer estado actual de HubSpot
  console.log('\n1️⃣  Estado actual en HubSpot...');
  try {
    const hsRes = await hubspotClient.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${hubspotId}`,
      { params: { properties: 'firstname,lastname,email,phone,address,city,country,state' } },
    );
    const p = hsRes.data.properties;
    pass(`HubSpot Contact: ${p.firstname} ${p.lastname} | email=${p.email}`);
  } catch (e) {
    fail('Leer HubSpot Contact', e);
    return;
  }

  // Paso 2: Modificar en SAP
  console.log('\n2️⃣  Modificando BP en SAP (PATCH FirstName)...');
  try {
    await sapClient.patchWithETag(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
      { FirstName: newFirstName },
    );
    pass(`SAP PATCH BP ${sapBPId} → FirstName="${newFirstName}"`);
  } catch (e) {
    fail('SAP PATCH BP', e);
    return;
  }

  // Paso 3: Leer BP completo de SAP (lo que haría el poller)
  console.log('\n3️⃣  Leyendo BP completo de SAP (simulando poller)...');
  let sapBP: SapBusinessPartner;
  let sapAddress: SapBPAddress | undefined;
  let sapEmail: string | undefined;
  let sapPhone: string | undefined;
  let sapMobile: string | undefined;

  try {
    const bpRes = await sapClient.get<ODataResponse<SapBusinessPartner>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
    );
    sapBP = bpRes.data.d;
    pass(`SAP BP: ${sapBP.FirstName} ${sapBP.LastName} | Category=${sapBP.BusinessPartnerCategory}`);

    // Address
    const addrRes = await sapClient.get<ODataListResponse<SapBPAddress>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')/to_BusinessPartnerAddress`,
    );
    if (addrRes.data.d.results?.length > 0) {
      sapAddress = addrRes.data.d.results[0];
      const addrId = sapAddress.AddressID;
      const person = sapAddress.Person || '';
      pass(`Address: ${sapAddress.StreetName}, ${sapAddress.CityName}, ${sapAddress.Country}`);

      // Email
      try {
        const emailRes = await sapClient.get<ODataListResponse<{ EmailAddress: string }>>(
          `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addrId}')/to_EmailAddress`,
        );
        if (emailRes.data.d.results?.length > 0) {
          sapEmail = emailRes.data.d.results[0].EmailAddress;
          pass(`Email: ${sapEmail}`);
        }
      } catch { /* sin email */ }

      // Phone
      try {
        const phoneRes = await sapClient.get<ODataListResponse<{ PhoneNumber: string }>>(
          `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addrId}')/to_PhoneNumber`,
        );
        if (phoneRes.data.d.results?.length > 0) {
          sapPhone = phoneRes.data.d.results[0].PhoneNumber;
          pass(`Phone: ${sapPhone}`);
        }
      } catch { /* sin phone */ }

      // Mobile
      try {
        const mobileRes = await sapClient.get<ODataListResponse<{ PhoneNumber: string }>>(
          `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addrId}')/to_MobilePhoneNumber`,
        );
        if (mobileRes.data.d.results?.length > 0) {
          sapMobile = mobileRes.data.d.results[0].PhoneNumber;
          pass(`Mobile: ${sapMobile}`);
        }
      } catch { /* sin mobile */ }
    }
  } catch (e) {
    fail('Leer SAP BP completo', e);
    return;
  }

  // Paso 4: Transformar con mapper inverso (SAP → HubSpot)
  console.log('\n4️⃣  Transformando SAP → HubSpot (mapper inverso)...');
  const hubspotProps = mapper.sapBPToContactUpdate(sapBP!, sapAddress, sapEmail, sapPhone, sapMobile);
  const cleanProps: Record<string, string> = {};
  for (const [key, val] of Object.entries(hubspotProps)) {
    if (val !== undefined && val !== null) cleanProps[key] = String(val);
  }
  pass(`Props para HubSpot: ${JSON.stringify(cleanProps)}`);

  // Paso 5: PATCH en HubSpot (simulando poller)
  console.log('\n5️⃣  PATCH en HubSpot (simulando poller)...');
  try {
    await hubspotClient.patch(
      `/crm/v3/objects/contacts/${hubspotId}`,
      { properties: cleanProps },
    );
    pass('HubSpot PATCH exitoso');
  } catch (e: unknown) {
    // HubSpot rechaza email duplicado — reintentar sin email (mismo manejo que el poller)
    const errMsg = e instanceof Error ? e.message : String(e);
    const isEmailConflict = errMsg.includes('already has that value') || errMsg.includes('400');
    if (isEmailConflict && cleanProps.email) {
      console.log('  ⚠️ Email duplicado en HubSpot — reintentando sin email...');
      const { email: _, ...propsWithoutEmail } = cleanProps;
      try {
        await hubspotClient.patch(
          `/crm/v3/objects/contacts/${hubspotId}`,
          { properties: propsWithoutEmail },
        );
        pass('HubSpot PATCH exitoso (sin email, email duplicado en otro contacto)');
      } catch (e2) {
        fail('HubSpot PATCH Contact (reintento sin email)', e2);
        return;
      }
    } else {
      fail('HubSpot PATCH Contact', e);
      return;
    }
  }

  // Paso 6: Verificar en HubSpot
  console.log('\n6️⃣  Verificando en HubSpot...');
  try {
    const verifyRes = await hubspotClient.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${hubspotId}`,
      { params: { properties: 'firstname,lastname,email,phone,address,city,country,state' } },
    );
    const p = verifyRes.data.properties;
    if (p.firstname === newFirstName) {
      pass(`firstname: "${p.firstname}" (coincide con SAP)`);
    } else {
      fail(`firstname: "${p.firstname}" (esperado: "${newFirstName}")`);
    }
    pass(`Resultado: ${p.firstname} ${p.lastname} | email=${p.email}`);
  } catch (e) {
    fail('Verificar HubSpot', e);
  }
}

// ---------------------------------------------------------------------------
// TEST 2: SAP → HubSpot Company (simulando poller)
// ---------------------------------------------------------------------------

async function testSapToHubSpotCompany() {
  section('TEST 2: SAP BP Org → HubSpot Company');

  const { hubspotId, sapBPId } = TEST_DATA.company;
  const ts = Date.now();
  const newName = `FromSAP_Empresa_${ts}`;

  // Modificar en SAP
  console.log('\n1️⃣  Modificando BP Org en SAP...');
  try {
    await sapClient.patchWithETag(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
      { OrganizationBPName1: newName.substring(0, 40) },
    );
    pass(`SAP PATCH BP ${sapBPId} → OrganizationBPName1="${newName.substring(0, 40)}"`);
  } catch (e) {
    fail('SAP PATCH BP Org', e);
    return;
  }

  // Leer de SAP
  console.log('\n2️⃣  Leyendo BP Org de SAP...');
  let sapBP: SapBusinessPartner;
  let sapAddress: SapBPAddress | undefined;
  try {
    const bpRes = await sapClient.get<ODataResponse<SapBusinessPartner>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
    );
    sapBP = bpRes.data.d;
    pass(`SAP BP: ${sapBP.OrganizationBPName1}`);

    const addrRes = await sapClient.get<ODataListResponse<SapBPAddress>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')/to_BusinessPartnerAddress`,
    );
    if (addrRes.data.d.results?.length > 0) {
      sapAddress = addrRes.data.d.results[0];
    }
  } catch (e) {
    fail('Leer SAP BP Org', e);
    return;
  }

  // Transformar
  console.log('\n3️⃣  Transformando SAP → HubSpot...');
  const hubspotProps = mapper.sapBPToCompanyUpdate(sapBP!, sapAddress);
  const cleanProps: Record<string, string> = {};
  for (const [key, val] of Object.entries(hubspotProps)) {
    if (val !== undefined && val !== null) cleanProps[key] = String(val);
  }
  pass(`Props: ${JSON.stringify(cleanProps)}`);

  // PATCH HubSpot
  console.log('\n4️⃣  PATCH en HubSpot...');
  try {
    await hubspotClient.patch(
      `/crm/v3/objects/companies/${hubspotId}`,
      { properties: cleanProps },
    );
    pass('HubSpot PATCH Company exitoso');
  } catch (e) {
    fail('HubSpot PATCH Company', e);
    return;
  }

  // Verificar
  console.log('\n5️⃣  Verificando en HubSpot...');
  try {
    const res = await hubspotClient.get<HubSpotCompany>(
      `/crm/v3/objects/companies/${hubspotId}`,
      { params: { properties: 'name' } },
    );
    if (res.data.properties.name === newName.substring(0, 40)) {
      pass(`name: "${res.data.properties.name}" (coincide con SAP)`);
    } else {
      fail(`name: "${res.data.properties.name}" (esperado: "${newName.substring(0, 40)}")`);
    }
  } catch (e) {
    fail('Verificar HubSpot Company', e);
  }
}

// ---------------------------------------------------------------------------
// TEST 3: SAP → HubSpot Deal (simulando poller)
// ---------------------------------------------------------------------------

async function testSapToHubSpotDeal() {
  section('TEST 3: SAP SalesOrder → HubSpot Deal');

  const { hubspotId, sapSOId } = TEST_DATA.deal;
  const ts = Date.now();
  const newPO = `PO-FromSAP-${ts}`.substring(0, 35);

  // Modificar en SAP
  console.log('\n1️⃣  Modificando SalesOrder en SAP...');
  try {
    await sapClient.patchWithETag(
      `/API_SALES_ORDER_SRV/A_SalesOrder('${sapSOId}')`,
      { PurchaseOrderByCustomer: newPO },
    );
    pass(`SAP PATCH SO ${sapSOId} → PurchaseOrderByCustomer="${newPO}"`);
  } catch (e) {
    fail('SAP PATCH SalesOrder', e);
    return;
  }

  // Leer de SAP
  console.log('\n2️⃣  Leyendo SalesOrder de SAP...');
  let salesOrder: SapSalesOrder;
  try {
    const soRes = await sapClient.get<ODataResponse<SapSalesOrder>>(
      `/API_SALES_ORDER_SRV/A_SalesOrder('${sapSOId}')`,
    );
    salesOrder = soRes.data.d;
    pass(`SAP SO: ${salesOrder.SalesOrder} | PO=${salesOrder.PurchaseOrderByCustomer} | Amount=${salesOrder.TotalNetAmount}`);
  } catch (e) {
    fail('Leer SAP SalesOrder', e);
    return;
  }

  // Transformar
  console.log('\n3️⃣  Transformando SAP → HubSpot...');
  const hubspotProps = mapper.salesOrderToDealUpdate(salesOrder!);
  const cleanProps: Record<string, string> = {};
  for (const [key, val] of Object.entries(hubspotProps)) {
    if (val !== undefined && val !== null) cleanProps[key] = String(val);
  }
  pass(`Props: ${JSON.stringify(cleanProps)}`);

  // PATCH HubSpot
  console.log('\n4️⃣  PATCH en HubSpot...');
  try {
    await hubspotClient.patch(
      `/crm/v3/objects/deals/${hubspotId}`,
      { properties: cleanProps },
    );
    pass('HubSpot PATCH Deal exitoso');
  } catch (e) {
    fail('HubSpot PATCH Deal', e);
    return;
  }

  // Verificar
  console.log('\n5️⃣  Verificando en HubSpot...');
  try {
    const res = await hubspotClient.get<HubSpotDeal>(
      `/crm/v3/objects/deals/${hubspotId}`,
      { params: { properties: 'dealname,amount,condicion_de_pago' } },
    );
    const p = res.data.properties;
    if (p.dealname === newPO) {
      pass(`dealname: "${p.dealname}" (coincide con PurchaseOrderByCustomer de SAP)`);
    } else {
      fail(`dealname: "${p.dealname}" (esperado: "${newPO}")`);
    }
    pass(`amount: ${p.amount} | condicion_de_pago: ${p.condicion_de_pago}`);
  } catch (e) {
    fail('Verificar HubSpot Deal', e);
  }
}

// ---------------------------------------------------------------------------
// TEST 4: Webhook end-to-end (verificar que Railway está procesando)
// ---------------------------------------------------------------------------

async function testWebhookEndToEnd() {
  section('TEST 4: Webhook end-to-end (HubSpot → Railway → SAP)');

  console.log('\n  ℹ️  Esta prueba verifica que el flujo webhook está activo.');
  console.log('  Creamos un Contact en HubSpot y verificamos que aparece en SAP.');
  console.log('  (requiere que Railway esté corriendo y webhooks configurados)\n');

  const ts = Date.now();

  // Crear un Contact nuevo en HubSpot
  console.log('1️⃣  Creando Contact de prueba en HubSpot...');
  let contactId: string;
  try {
    const res = await hubspotClient.post<HubSpotContact>(
      '/crm/v3/objects/contacts',
      {
        properties: {
          firstname: 'WebhookTest',
          lastname: `E2E_${ts}`,
          email: `webhook_e2e_${ts}@test.cl`,
          phone: '+56944444444',
          country: 'CL',
          city: 'Santiago',
          state: 'Metropolitana',
          address: `Calle Webhook ${ts % 1000}`,
        },
      },
    );
    contactId = res.data.id;
    pass(`HubSpot CREATE Contact → ID: ${contactId}`);
  } catch (e) {
    fail('HubSpot CREATE Contact', e);
    return;
  }

  // Esperar a que el webhook sea procesado por Railway
  console.log('\n2️⃣  Esperando 30 segundos para que el webhook sea procesado...');
  console.log('     (HubSpot envía webhooks en batches cada ~30s)\n');
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Verificar si el Contact tiene id_sap (writeback del sync)
  console.log('3️⃣  Verificando si el Contact tiene id_sap (writeback)...');
  try {
    const res = await hubspotClient.get<HubSpotContact>(
      `/crm/v3/objects/contacts/${contactId}`,
      { params: { properties: 'firstname,lastname,id_sap' } },
    );
    const idSap = res.data.properties.id_sap;
    if (idSap) {
      pass(`id_sap: ${idSap} (¡webhook procesado exitosamente!)`);

      // Verificar en SAP
      console.log('\n4️⃣  Verificando BP creado en SAP...');
      try {
        const bpRes = await sapClient.get<ODataResponse<SapBusinessPartner>>(
          `/API_BUSINESS_PARTNER/A_BusinessPartner('${idSap}')`,
        );
        const bp = bpRes.data.d;
        pass(`SAP BP: ${bp.FirstName} ${bp.LastName} | ID=${bp.BusinessPartner}`);
        if (bp.FirstName === 'WebhookTest') {
          pass('FirstName coincide → flujo webhook completo verificado');
        } else {
          fail(`FirstName "${bp.FirstName}" no coincide con "WebhookTest"`);
        }
      } catch (e) {
        fail('Leer SAP BP', e);
      }
    } else {
      console.log('  ⏳ id_sap aún es null. Esperando 30 segundos más...');
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Segundo intento
      const res2 = await hubspotClient.get<HubSpotContact>(
        `/crm/v3/objects/contacts/${contactId}`,
        { params: { properties: 'id_sap' } },
      );
      const idSap2 = res2.data.properties.id_sap;
      if (idSap2) {
        pass(`id_sap: ${idSap2} (webhook procesado en segundo intento)`);
      } else {
        fail('id_sap sigue null después de 60s. Verificar logs de Railway.');
      }
    }
  } catch (e) {
    fail('Verificar id_sap', e);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST: SAP → HubSpot + Webhook E2E                       ║');
  console.log('║  Pruebas de sincronización inversa y flujo completo       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Test 1: Contact SAP → HubSpot
  await testSapToHubSpotContact();

  // Test 2: Company SAP → HubSpot
  await testSapToHubSpotCompany();

  // Test 3: Deal SAP → HubSpot
  await testSapToHubSpotDeal();

  // Test 4: Webhook E2E (tarda ~60s)
  await testWebhookEndToEnd();

  // Resumen
  section('RESUMEN');
  console.log(`  ✅ Pasaron:  ${passCount}`);
  console.log(`  ❌ Fallaron: ${failCount}`);
  console.log(`  Total:      ${passCount + failCount}`);

  if (failCount > 0) {
    console.log('\n⚠️  Hay pruebas fallidas.');
    process.exit(1);
  } else {
    console.log('\n🎉 Todas las pruebas SAP→HubSpot pasaron.');
  }
}

main().catch((e) => {
  console.error('Error fatal:', e.message);
  if (e.response?.data) console.error('Detail:', JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
