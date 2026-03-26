/**
 * Prueba UPDATE completo de Contact: actualizar todos los campos en HubSpot,
 * luego PATCH al BP de SAP + sub-entities (address, email, phone, mobile).
 *
 * Usa el BP 100000061 creado por la integration-test anterior.
 * Uso: npx tsx src/scripts/test-contact-update-full.ts
 */
import 'dotenv/config';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';
import { sapClient } from '../adapters/sap/sap.client';
import * as mapper from '../services/mapper.service';
import type { HubSpotContact } from '../adapters/hubspot/hubspot.types';
import type { ODataResponse, SapBusinessPartner, ODataListResponse, SapBPAddress } from '../adapters/sap/sap.types';

// IDs del Contact de prueba (creado en la integration-test anterior)
const HUBSPOT_CONTACT_ID = '211723264183';
const SAP_BP_ID = '100000061';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  TEST: Contact UPDATE completo (todos los campos)         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // ─── PASO 1: Actualizar Contact en HubSpot con todos los campos ───
  console.log('\n1️⃣  Actualizando Contact en HubSpot...');
  const ts = Date.now();
  const updateProps = {
    firstname: `FullUpdate_${ts}`,
    lastname: `TestLastName_${ts}`,
    email: `fullupdate_${ts}@integration.cl`,
    phone: '+56922222222',
    mobilephone: '+56933333333',
    address: `Av. Providencia ${ts % 1000}`,
    city: 'Providencia',
    zip: '7500000',
    country: 'Chile',
    state: 'Metropolitana',
    comuna: 'Providencia',
  };

  await hubspotClient.patch(
    `/crm/v3/objects/contacts/${HUBSPOT_CONTACT_ID}`,
    { properties: updateProps },
  );
  console.log('   ✅ HubSpot PATCH exitoso');
  console.log(`   Props enviadas: ${JSON.stringify(updateProps, null, 2)}`);

  // ─── PASO 2: Leer Contact actualizado de HubSpot ───
  console.log('\n2️⃣  Leyendo Contact actualizado de HubSpot...');
  const hsRes = await hubspotClient.get<HubSpotContact>(
    `/crm/v3/objects/contacts/${HUBSPOT_CONTACT_ID}`,
    { params: { properties: 'firstname,lastname,email,phone,mobilephone,address,city,zip,country,state,comuna' } },
  );
  const props = hsRes.data.properties;
  console.log(`   firstname:    ${props.firstname}`);
  console.log(`   lastname:     ${props.lastname}`);
  console.log(`   email:        ${props.email}`);
  console.log(`   phone:        ${props.phone}`);
  console.log(`   mobilephone:  ${props.mobilephone}`);
  console.log(`   address:      ${props.address}`);
  console.log(`   city:         ${props.city}`);
  console.log(`   zip:          ${props.zip}`);
  console.log(`   country:      ${props.country}`);
  console.log(`   state:        ${props.state}`);
  console.log(`   comuna:       ${props.comuna}`);

  // ─── PASO 3: PATCH campos principales del BP ───
  console.log('\n3️⃣  PATCH campos principales del BP en SAP...');
  const bpUpdatePayload = mapper.contactToSapBPUpdate(props);
  console.log(`   Payload BP: ${JSON.stringify(bpUpdatePayload)}`);
  await sapClient.patchWithETag(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${SAP_BP_ID}')`,
    bpUpdatePayload,
  );
  console.log('   ✅ SAP PATCH BP exitoso (204)');

  // ─── PASO 4: Obtener AddressID ───
  console.log('\n4️⃣  Obteniendo AddressID del BP...');
  const addrRes = await sapClient.get<ODataListResponse<SapBPAddress>>(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${SAP_BP_ID}')/to_BusinessPartnerAddress`,
  );
  const addresses = addrRes.data.d.results;
  if (!addresses || addresses.length === 0) {
    console.error('   ❌ BP no tiene Address');
    return;
  }
  const addressId = addresses[0].AddressID;
  const person = addresses[0].Person || '';
  console.log(`   AddressID: ${addressId}, Person: ${person}`);

  // ─── PASO 5: PATCH Address fields ───
  console.log('\n5️⃣  PATCH Address sub-entity...');
  const addressPayload = mapper.extractAddressPayload(props);
  console.log(`   Payload Address: ${JSON.stringify(addressPayload)}`);
  if (Object.keys(addressPayload).length > 0) {
    await sapClient.patchWithETag(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${SAP_BP_ID}',AddressID='${addressId}')`,
      addressPayload,
    );
    console.log('   ✅ SAP PATCH Address exitoso');
  }

  // ─── PASO 6: PATCH/POST Email ───
  console.log('\n6️⃣  PATCH Email sub-entity...');
  const emailPayload = mapper.extractEmailPayload(props);
  if (emailPayload) {
    try {
      await sapClient.patchWithETag(
        `/API_BUSINESS_PARTNER/A_AddressEmailAddress(AddressID='${addressId}',Person='${person}',OrdinalNumber='1')`,
        emailPayload,
      );
      console.log('   ✅ Email actualizado');
    } catch {
      await sapClient.post(
        `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${SAP_BP_ID}',AddressID='${addressId}')/to_EmailAddress`,
        emailPayload,
      );
      console.log('   ✅ Email creado (POST)');
    }
  }

  // ─── PASO 7: PATCH/POST Phone ───
  console.log('\n7️⃣  PATCH Phone sub-entity...');
  const phonePayload = mapper.extractPhonePayload(props);
  if (phonePayload) {
    try {
      await sapClient.patchWithETag(
        `/API_BUSINESS_PARTNER/A_AddressPhoneNumber(AddressID='${addressId}',Person='${person}',OrdinalNumber='1')`,
        phonePayload,
      );
      console.log('   ✅ Phone actualizado');
    } catch {
      await sapClient.post(
        `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${SAP_BP_ID}',AddressID='${addressId}')/to_PhoneNumber`,
        phonePayload,
      );
      console.log('   ✅ Phone creado (POST)');
    }
  }

  // ─── PASO 8: PATCH/POST Mobile ───
  console.log('\n8️⃣  PATCH Mobile sub-entity...');
  const mobilePayload = mapper.extractMobilePayload(props);
  if (mobilePayload) {
    try {
      await sapClient.patchWithETag(
        `/API_BUSINESS_PARTNER/A_AddressPhoneNumber(AddressID='${addressId}',Person='${person}',OrdinalNumber='2')`,
        mobilePayload,
      );
      console.log('   ✅ Mobile actualizado');
    } catch {
      try {
        await sapClient.post(
          `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${SAP_BP_ID}',AddressID='${addressId}')/to_MobilePhoneNumber`,
          mobilePayload,
        );
        console.log('   ✅ Mobile creado (POST)');
      } catch (e: unknown) {
        console.error(`   ❌ Mobile error: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ─── PASO 9: Verificar todo en SAP ───
  console.log('\n9️⃣  Verificando resultado final en SAP...');
  console.log('────────────────────────────────────────────────');

  // BP principal
  const bpRes = await sapClient.get<ODataResponse<SapBusinessPartner>>(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${SAP_BP_ID}')`,
  );
  const bp = bpRes.data.d;
  const checkBP = (field: string, expected: string | undefined, actual: string | undefined) => {
    const ok = expected === actual || (expected && actual?.includes(expected));
    console.log(`  ${ok ? '✅' : '❌'} ${field}: "${actual}" ${ok ? '' : `(esperado: "${expected}")`}`);
  };
  checkBP('FirstName', updateProps.firstname, bp.FirstName);
  checkBP('LastName', updateProps.lastname, bp.LastName);

  // Address
  const verifyAddr = await sapClient.get<ODataListResponse<SapBPAddress>>(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${SAP_BP_ID}')/to_BusinessPartnerAddress`,
  );
  const va = verifyAddr.data.d.results[0];
  checkBP('StreetName', `Av. Providencia ${ts % 1000}`, va.StreetName);
  checkBP('CityName', 'Providencia', va.CityName);
  checkBP('PostalCode', '7500000', va.PostalCode);
  checkBP('Country', 'CL', va.Country);
  checkBP('Region', 'RM', va.Region);  // Metropolitana → RM
  checkBP('District', 'Providencia', va.District);

  // Email
  try {
    const emailRes = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${SAP_BP_ID}',AddressID='${addressId}')/to_EmailAddress`,
    );
    const emails = emailRes.data.d.results;
    if (emails.length > 0) {
      checkBP('Email', `fullupdate_${ts}@integration.cl`, emails[0].EmailAddress);
    } else {
      console.log('  ❌ Email: no encontrado');
    }
  } catch { console.log('  ❌ Email: error al leer'); }

  // Phone
  try {
    const phoneRes = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${SAP_BP_ID}',AddressID='${addressId}')/to_PhoneNumber`,
    );
    const phones = phoneRes.data.d.results;
    if (phones.length > 0) {
      checkBP('Phone', '922222222', phones[0].PhoneNumber);
    } else {
      console.log('  ❌ Phone: no encontrado');
    }
  } catch { console.log('  ❌ Phone: error al leer'); }

  // Mobile
  try {
    const mobileRes = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${SAP_BP_ID}',AddressID='${addressId}')/to_MobilePhoneNumber`,
    );
    const mobiles = mobileRes.data.d.results;
    if (mobiles.length > 0) {
      checkBP('Mobile', '933333333', mobiles[0].PhoneNumber);
    } else {
      console.log('  ⚠️ Mobile: no encontrado (puede no haberse creado)');
    }
  } catch { console.log('  ❌ Mobile: error al leer'); }

  console.log('\n✅ Test Contact UPDATE completo finalizado.');
}

main().catch((e) => {
  console.error('Error fatal:', e.message);
  if (e.response?.data) {
    console.error('SAP detail:', JSON.stringify(e.response.data, null, 2));
  }
  process.exit(1);
});
