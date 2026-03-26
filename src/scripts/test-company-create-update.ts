/**
 * Prueba CREATE y UPDATE completo de Company → SAP BP Organización (Category=2).
 *
 * Flujo:
 *   1. CREATE Company en HubSpot con todos los campos
 *   2. Leer Company de HubSpot
 *   3. Transformar con mapper y CREATE BP Org en SAP
 *   4. Sync sub-entities (Address, Phone)
 *   5. Verificar todos los campos en SAP
 *   6. UPDATE Company en HubSpot (cambiar nombre, dirección, teléfono)
 *   7. PATCH BP principal + sub-entities en SAP
 *   8. Verificar UPDATE en SAP
 *
 * Uso: npx tsx src/scripts/test-company-create-update.ts
 */
import 'dotenv/config';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import { sapClient } from '../adapters/sap/sap.client';
import * as mapper from '../services/mapper.service';
import type { HubSpotCompany } from '../adapters/hubspot/hubspot.types';
import type {
  ODataResponse,
  ODataListResponse,
  SapBusinessPartner,
  SapBPAddress,
} from '../adapters/sap/sap.types';

let passCount = 0;
let failCount = 0;

function pass(msg: string) { passCount++; console.log(`  ✅ ${msg}`); }
function fail(msg: string, e?: unknown) {
  failCount++;
  const detail = e instanceof Error ? e.message : e ? String(e) : '';
  console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ''}`);
}

function check(field: string, expected: string | undefined, actual: string | undefined, caseInsensitive = false) {
  const matches = caseInsensitive
    ? expected?.toUpperCase() === actual?.toUpperCase()
    : expected === actual || (expected != null && actual?.includes(expected));
  if (matches) {
    pass(`${field}: "${actual}"`);
  } else {
    fail(`${field}: "${actual}" (esperado: "${expected}")`);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST: Company CREATE + UPDATE completo → SAP BP Org      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const ts = Date.now();

  // ═══════════════════════════════════════════════════════════════════════
  // PARTE 1: CREATE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════ CREATE ══════════════════');

  // ── 1. Crear Company en HubSpot ──
  console.log('\n1️⃣  Creando Company en HubSpot...');
  const createProps = {
    name: `TestCompany_${ts}`,
    phone: '+56228887777',
    address: 'Av. Apoquindo 4000',
    city: 'Las Condes',
    zip: '7550000',
    country: 'Chile',
    state: 'Metropolitana',
    comuna: 'Las Condes',
    rut_empresa: `76.${String(ts).slice(-3)}.${String(ts).slice(-6, -3)}-K`,
    razon_social: `Razon Social Test ${ts}`,
  };

  let companyId: string;
  try {
    const res = await hubspotClient.post<HubSpotCompany>(
      '/crm/v3/objects/companies',
      { properties: createProps },
    );
    companyId = res.data.id;
    pass(`HubSpot CREATE Company → ID: ${companyId}`);
  } catch (e: unknown) {
    fail('HubSpot CREATE Company', e);
    return;
  }

  // ── 2. Leer Company creada ──
  console.log('\n2️⃣  Leyendo Company de HubSpot...');
  let props: HubSpotCompany['properties'];
  try {
    const res = await hubspotClient.get<HubSpotCompany>(
      `/crm/v3/objects/companies/${companyId}`,
      { params: { properties: 'name,phone,address,city,zip,country,state,comuna,rut_empresa,razon_social,description' } },
    );
    props = res.data.properties;
    pass(`Company: ${props.name}`);
    console.log(`   phone:        ${props.phone}`);
    console.log(`   address:      ${props.address}`);
    console.log(`   city:         ${props.city}`);
    console.log(`   country:      ${props.country}`);
    console.log(`   state:        ${props.state}`);
    console.log(`   rut_empresa:  ${props.rut_empresa}`);
    console.log(`   razon_social: ${props.razon_social}`);
  } catch (e) {
    fail('HubSpot READ Company', e);
    return;
  }

  // ── 3. Transformar y crear en SAP ──
  console.log('\n3️⃣  Creando BP Organización en SAP...');
  let sapBPId: string;
  try {
    const payload = mapper.companyToSapBP(props, companyId);
    console.log(`   Payload (resumen):`);
    console.log(`     Category: ${payload.BusinessPartnerCategory}`);
    console.log(`     Name1: ${payload.OrganizationBPName1}`);
    console.log(`     Name3 (razon_social): ${payload.OrganizationBPName3}`);
    console.log(`     SearchTerm1: ${payload.SearchTerm1}`);
    console.log(`     ExtSystem: ${payload.BusinessPartnerIDByExtSystem}`);
    console.log(`     Tax: ${JSON.stringify(payload.to_BusinessPartnerTax?.results)}`);

    const res = await sapClient.post<ODataResponse<{ BusinessPartner: string }>>(
      '/API_BUSINESS_PARTNER/A_BusinessPartner',
      payload,
    );
    sapBPId = res.data.d.BusinessPartner;
    pass(`SAP CREATE BP Org → ID: ${sapBPId}`);
  } catch (e: unknown) {
    fail('SAP CREATE BP Org', e);
    if (e && typeof e === 'object' && 'response' in e) {
      const axErr = e as { response?: { data?: unknown } };
      if (axErr.response?.data) {
        console.log('   SAP Error:', JSON.stringify(axErr.response.data, null, 2));
      }
    }
    return;
  }

  // ── 4. Sync sub-entities (Address, Phone) ──
  console.log('\n4️⃣  Sincronizando sub-entities (Address, Phone)...');
  let addressId: string;
  try {
    // Obtener AddressID
    const addrRes = await sapClient.get<ODataListResponse<SapBPAddress>>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')/to_BusinessPartnerAddress`,
    );
    const addresses = addrRes.data.d.results;
    if (!addresses || addresses.length === 0) {
      fail('BP no tiene Address');
      return;
    }
    addressId = addresses[0].AddressID!;
    pass(`AddressID: ${addressId}`);

    // PATCH Address
    const addressPayload = mapper.extractAddressPayload(props);
    if (Object.keys(addressPayload).length > 0) {
      await sapClient.patchWithETag(
        `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addressId}')`,
        addressPayload,
      );
      pass('Address PATCH exitoso');
    }

    // PATCH/POST Phone
    const phonePayload = mapper.extractPhonePayload(props);
    if (phonePayload) {
      try {
        await sapClient.patchWithETag(
          `/API_BUSINESS_PARTNER/A_AddressPhoneNumber(AddressID='${addressId}',Person='',OrdinalNumber='1')`,
          phonePayload,
        );
        pass('Phone actualizado');
      } catch {
        await sapClient.post(
          `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addressId}')/to_PhoneNumber`,
          phonePayload,
        );
        pass('Phone creado (POST)');
      }
    }
  } catch (e) {
    fail('Sub-entities sync', e);
    return;
  }

  // ── 5. Verificar CREATE en SAP ──
  console.log('\n5️⃣  Verificando CREATE en SAP...');
  console.log('────────────────────────────────────────');

  // BP principal
  const bpRes = await sapClient.get<ODataResponse<SapBusinessPartner>>(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
  );
  const bp = bpRes.data.d;
  check('Category', '2', bp.BusinessPartnerCategory);
  check('OrganizationBPName1', createProps.name.substring(0, 40), bp.OrganizationBPName1);
  check('OrganizationBPName3', createProps.razon_social.substring(0, 40), bp.OrganizationBPName3);
  check('SearchTerm1', createProps.razon_social.substring(0, 20), bp.SearchTerm1, true);
  check('ExtSystem (HubSpot ID)', companyId, bp.BusinessPartnerIDByExtSystem);

  // Address
  const vaRes = await sapClient.get<ODataListResponse<SapBPAddress>>(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')/to_BusinessPartnerAddress`,
  );
  const va = vaRes.data.d.results[0];
  check('StreetName', 'Av. Apoquindo 4000', va.StreetName);
  check('CityName', 'Las Condes', va.CityName);
  check('PostalCode', '7550000', va.PostalCode);
  check('Country', 'CL', va.Country);
  check('Region', 'RM', va.Region);
  check('District', 'Las Condes', va.District);

  // Tax
  const taxRes = await sapClient.get(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')/to_BusinessPartnerTax`,
  );
  const taxes = taxRes.data.d.results;
  if (taxes.length > 0) {
    check('BPTaxType', 'CO3', taxes[0].BPTaxType);
    const expectedRut = mapper.normalizeRut(createProps.rut_empresa);
    check('BPTaxNumber (RUT)', expectedRut, taxes[0].BPTaxNumber);
  } else {
    fail('No tax entries found');
  }

  // Phone
  try {
    const phoneRes = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addressId}')/to_PhoneNumber`,
    );
    const phones = phoneRes.data.d.results;
    if (phones.length > 0) {
      check('Phone', '228887777', phones[0].PhoneNumber);
    } else {
      fail('Phone: no encontrado');
    }
  } catch { fail('Phone: error al leer'); }

  // ═══════════════════════════════════════════════════════════════════════
  // PARTE 2: UPDATE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n\n══════════════════ UPDATE ══════════════════');

  // ── 6. Actualizar Company en HubSpot ──
  console.log('\n6️⃣  Actualizando Company en HubSpot...');
  const ts2 = Date.now();
  const updateProps = {
    name: `UpdatedCompany_${ts2}`,
    phone: '+56229998888',
    address: 'Av. Las Condes 9999',
    city: 'Vitacura',
    zip: '7630000',
    state: 'Valparaíso',
    comuna: 'Vitacura',
    razon_social: `Razon Updated ${ts2}`,
  };

  try {
    await hubspotClient.patch(
      `/crm/v3/objects/companies/${companyId}`,
      { properties: updateProps },
    );
    pass('HubSpot PATCH Company exitoso');
  } catch (e) {
    fail('HubSpot PATCH Company', e);
    return;
  }

  // Leer actualizado
  const updRes = await hubspotClient.get<HubSpotCompany>(
    `/crm/v3/objects/companies/${companyId}`,
    { params: { properties: 'name,phone,address,city,zip,country,state,comuna,razon_social' } },
  );
  const updProps = updRes.data.properties;

  // ── 7. PATCH BP principal ──
  console.log('\n7️⃣  PATCH BP principal en SAP...');
  const bpUpdatePayload = mapper.companyToSapBPUpdate(updProps);
  console.log(`   Payload: ${JSON.stringify(bpUpdatePayload)}`);
  try {
    await sapClient.patchWithETag(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
      bpUpdatePayload,
    );
    pass('SAP PATCH BP exitoso');
  } catch (e) {
    fail('SAP PATCH BP', e);
  }

  // ── 8. PATCH Address sub-entity ──
  console.log('\n8️⃣  PATCH Address sub-entity...');
  const addrUpdatePayload = mapper.extractAddressPayload(updProps);
  console.log(`   Payload: ${JSON.stringify(addrUpdatePayload)}`);
  try {
    await sapClient.patchWithETag(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addressId}')`,
      addrUpdatePayload,
    );
    pass('Address PATCH exitoso');
  } catch (e) {
    fail('Address PATCH', e);
  }

  // PATCH Phone
  console.log('\n   PATCH Phone...');
  const phoneUpdate = mapper.extractPhonePayload(updProps);
  if (phoneUpdate) {
    try {
      await sapClient.patchWithETag(
        `/API_BUSINESS_PARTNER/A_AddressPhoneNumber(AddressID='${addressId}',Person='',OrdinalNumber='1')`,
        phoneUpdate,
      );
      pass('Phone PATCH exitoso');
    } catch (e) {
      fail('Phone PATCH', e);
    }
  }

  // ── 9. Verificar UPDATE en SAP ──
  console.log('\n9️⃣  Verificando UPDATE en SAP...');
  console.log('────────────────────────────────────────');

  const bpUpd = await sapClient.get<ODataResponse<SapBusinessPartner>>(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')`,
  );
  check('OrganizationBPName1 (updated)', updateProps.name.substring(0, 40), bpUpd.data.d.OrganizationBPName1);
  check('OrganizationBPName3 (updated)', updateProps.razon_social.substring(0, 40), bpUpd.data.d.OrganizationBPName3);
  check('SearchTerm1 (updated)', updateProps.razon_social.substring(0, 20), bpUpd.data.d.SearchTerm1, true);

  const vaUpd = await sapClient.get<ODataListResponse<SapBPAddress>>(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${sapBPId}')/to_BusinessPartnerAddress`,
  );
  const va2 = vaUpd.data.d.results[0];
  check('StreetName (updated)', 'Av. Las Condes 9999', va2.StreetName);
  check('CityName (updated)', 'Vitacura', va2.CityName);
  check('PostalCode (updated)', '7630000', va2.PostalCode);
  check('Region (updated)', 'VS', va2.Region); // Valparaíso → VS
  check('District (updated)', 'Vitacura', va2.District);

  try {
    const phoneUpd = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${sapBPId}',AddressID='${addressId}')/to_PhoneNumber`,
    );
    if (phoneUpd.data.d.results.length > 0) {
      check('Phone (updated)', '229998888', phoneUpd.data.d.results[0].PhoneNumber);
    }
  } catch { fail('Phone updated: error al leer'); }

  // ═══════════════════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════ RESUMEN ══════════════════');
  console.log(`  ✅ Pasaron:  ${passCount}`);
  console.log(`  ❌ Fallaron: ${failCount}`);
  console.log(`  Total:      ${passCount + failCount}`);
  console.log(`\n  HubSpot Company ID: ${companyId}`);
  console.log(`  SAP BP Org ID:      ${sapBPId}`);

  if (failCount > 0) {
    console.log('\n⚠️  Hay pruebas fallidas.');
    process.exit(1);
  } else {
    console.log('\n🎉 Company CREATE + UPDATE: todos los campos verificados.');
  }
}

main().catch((e) => {
  console.error('Error fatal:', e.message);
  if (e.response?.data) {
    console.error('SAP detail:', JSON.stringify(e.response.data, null, 2));
  }
  process.exit(1);
});
