import 'dotenv/config';
import { sapClient } from '../adapters/sap/sap.client';

async function main() {
  // BP que funciona como SoldToParty (70123456)
  console.log('=== BP 70123456 (funciona como SoldToParty) ===');
  try {
    const res70 = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_Customer('70123456')/to_CustomerSalesArea`
    );
    const areas70 = (res70.data as any).d.results;
    if (areas70.length === 0) {
      console.log('  VACÍO — no tiene CustomerSalesArea');
    } else {
      for (const a of areas70) {
        console.log(`  SalesOrg=${a.SalesOrganization} DistCh=${a.DistributionChannel} Div=${a.Division}`);
      }
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.response?.status} ${e.response?.data?.error?.message?.value || e.message}`);
  }

  // BP recién creado (100000071)
  console.log('\n=== BP 100000071 (creado hoy, falla como SoldToParty) ===');
  try {
    const res71 = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_Customer('100000071')/to_CustomerSalesArea`
    );
    const areas71 = (res71.data as any).d.results;
    if (areas71.length === 0) {
      console.log('  VACÍO — no tiene CustomerSalesArea ← ESTO ES EL PROBLEMA');
    } else {
      for (const a of areas71) {
        console.log(`  SalesOrg=${a.SalesOrganization} DistCh=${a.DistributionChannel} Div=${a.Division}`);
      }
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.response?.status} ${e.response?.data?.error?.message?.value || e.message}`);
  }

  // BP anterior que también funcionó (100000030)
  console.log('\n=== BP 100000030 (Empresa Test SAP Integration, funciona) ===');
  try {
    const res30 = await sapClient.get(
      `/API_BUSINESS_PARTNER/A_Customer('100000030')/to_CustomerSalesArea`
    );
    const areas30 = (res30.data as any).d.results;
    if (areas30.length === 0) {
      console.log('  VACÍO');
    } else {
      for (const a of areas30) {
        console.log(`  SalesOrg=${a.SalesOrganization} DistCh=${a.DistributionChannel} Div=${a.Division}`);
      }
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.response?.status} ${e.response?.data?.error?.message?.value || e.message}`);
  }
}

main().catch(console.error);
