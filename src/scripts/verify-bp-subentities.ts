/**
 * Verifica las sub-entities (Address, Email, Phone, Mobile) de un BP en SAP.
 * Uso: npx tsx src/scripts/verify-bp-subentities.ts <BP_ID>
 */
import 'dotenv/config';
import { sapClient } from '../adapters/sap/sap.client';

async function main() {
  const bpId = process.argv[2] || '100000061';
  console.log(`\n🔍 Verificando sub-entities de BP ${bpId}...\n`);

  // 1. Address
  const addrRes = await sapClient.get(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${bpId}')/to_BusinessPartnerAddress`,
  );
  const addresses = addrRes.data.d.results;
  console.log('=== ADDRESS ===');
  if (!addresses || addresses.length === 0) {
    console.log('  ⚠️ No hay Address');
    return;
  }

  const a = addresses[0];
  console.log(`  AddressID: ${a.AddressID}`);
  console.log(`  Person:    ${a.Person}`);
  console.log(`  StreetName: ${a.StreetName || '(vacío)'}`);
  console.log(`  CityName:   ${a.CityName || '(vacío)'}`);
  console.log(`  PostalCode:  ${a.PostalCode || '(vacío)'}`);
  console.log(`  Country:    ${a.Country || '(vacío)'}`);
  console.log(`  Region:     ${a.Region || '(vacío)'}`);
  console.log(`  District:   ${a.District || '(vacío)'}`);

  const addrId = a.AddressID;

  // 2. Email
  console.log('\n=== EMAIL ===');
  try {
    const emailRes = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${bpId}',AddressID='${addrId}')/to_EmailAddress`,
    );
    const emails = emailRes.data.d.results;
    if (emails && emails.length > 0) {
      emails.forEach((e: Record<string, unknown>, i: number) => {
        console.log(`  [${i}] OrdinalNumber=${e.OrdinalNumber}, EmailAddress=${e.EmailAddress}`);
      });
    } else {
      console.log('  ⚠️ No hay emails');
    }
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : e}`);
  }

  // 3. Phone
  console.log('\n=== PHONE ===');
  try {
    const phoneRes = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${bpId}',AddressID='${addrId}')/to_PhoneNumber`,
    );
    const phones = phoneRes.data.d.results;
    if (phones && phones.length > 0) {
      phones.forEach((p: Record<string, unknown>, i: number) => {
        console.log(`  [${i}] OrdinalNumber=${p.OrdinalNumber}, PhoneNumber=${p.PhoneNumber}, Type=${p.PhoneNumberType}, Country=${p.DestinationLocationCountry}`);
      });
    } else {
      console.log('  ⚠️ No hay teléfonos');
    }
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : e}`);
  }

  // 4. Mobile
  console.log('\n=== MOBILE ===');
  try {
    const mobileRes = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_BusinessPartnerAddress(BusinessPartner='${bpId}',AddressID='${addrId}')/to_MobilePhoneNumber`,
    );
    const mobiles = mobileRes.data.d.results;
    if (mobiles && mobiles.length > 0) {
      mobiles.forEach((m: Record<string, unknown>, i: number) => {
        console.log(`  [${i}] OrdinalNumber=${m.OrdinalNumber}, PhoneNumber=${m.PhoneNumber}, Country=${m.DestinationLocationCountry}`);
      });
    } else {
      console.log('  ⚠️ No hay móviles');
    }
  } catch (e: unknown) {
    console.log(`  ❌ Error: ${e instanceof Error ? e.message : e}`);
  }

  // 5. BP datos principales
  console.log('\n=== BP PRINCIPAL ===');
  const bpRes = await sapClient.get(
    `/API_BUSINESS_PARTNER/A_BusinessPartner('${bpId}')`,
  );
  const bp = bpRes.data.d;
  console.log(`  FirstName: ${bp.FirstName || '(vacío)'}`);
  console.log(`  LastName:  ${bp.LastName || '(vacío)'}`);
  console.log(`  Category:  ${bp.BusinessPartnerCategory}`);
  console.log(`  ExtSystem: ${bp.BusinessPartnerIDByExtSystem || '(vacío)'}`);
  console.log(`  Employer:  ${bp.NaturalPersonEmployerName || '(vacío)'}`);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
