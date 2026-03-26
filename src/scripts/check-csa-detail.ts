import 'dotenv/config';
import { sapClient } from '../adapters/sap/sap.client';

async function main() {
  const res = await sapClient.get<any>(
    `/API_BUSINESS_PARTNER/A_Customer('70123456')/to_CustomerSalesArea`
  );
  const areas = res.data.d.results;
  if (areas.length > 0) {
    const area = areas[0]; // SalesOrg=4601, DistCh=CF, Div=10
    const filled: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(area)) {
      if (v !== '' && v !== null && v !== undefined && !k.startsWith('__') && !k.startsWith('to_')) {
        filled[k] = v;
      }
    }
    console.log('=== CustomerSalesArea de BP 70123456 (SalesOrg=4601, DistCh=CF, Div=10) ===');
    console.log(JSON.stringify(filled, null, 2));
  } else {
    console.log('Sin resultados');
  }
}
main().catch(console.error);
