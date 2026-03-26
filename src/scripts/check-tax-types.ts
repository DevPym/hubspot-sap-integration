/**
 * Verifica los BPTaxType de BPs existentes en SAP.
 * Uso: npx tsx src/scripts/check-tax-types.ts
 */
import 'dotenv/config';
import { sapClient } from '../adapters/sap/sap.client';

async function main() {
  const bps = ['100000030', '70123456', '100000031'];

  for (const bpId of bps) {
    try {
      const res = await sapClient.get(
        `/API_BUSINESS_PARTNER/A_BusinessPartner('${bpId}')/to_BusinessPartnerTax`,
      );
      const results = res.data.d.results;
      console.log(`\nBP ${bpId} — Tax entries: ${results.length}`);
      results.forEach((t: Record<string, unknown>, i: number) => {
        console.log(`  [${i}] BPTaxType=${t.BPTaxType}, BPTaxNumber=${t.BPTaxNumber}`);
      });
    } catch (e: unknown) {
      console.log(`BP ${bpId} — Error: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch(console.error);
