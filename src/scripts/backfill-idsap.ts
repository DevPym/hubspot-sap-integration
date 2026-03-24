/**
 * backfill-idsap.ts — Escribe id_sap en HubSpot para todos los mapeos existentes en id_map.
 *
 * Ejecutar: npx tsx src/scripts/backfill-idsap.ts
 */

import 'dotenv/config';
import { prisma } from '../db/prisma.client';
import { hubspotClient } from '../adapters/hubspot/hubspot.client';

const ENTITY_TO_HS_OBJECT: Record<string, string> = {
  CONTACT: 'contacts',
  COMPANY: 'companies',
  DEAL: 'deals',
};

async function main() {
  console.log('Backfill id_sap en HubSpot para todos los mapeos en id_map...\n');

  const maps = await prisma.idMap.findMany();
  console.log(`Encontrados ${maps.length} mapeos.\n`);

  for (const map of maps) {
    const hsObject = ENTITY_TO_HS_OBJECT[map.entityType];
    if (!hsObject) continue;

    try {
      await hubspotClient.patch(
        `/crm/v3/objects/${hsObject}/${map.hubspotId}`,
        { properties: { id_sap: map.sapId } },
      );
      console.log(`  ✅ ${map.entityType} HS:${map.hubspotId} → id_sap=${map.sapId}`);
    } catch (e) {
      console.error(`  ❌ ${map.entityType} HS:${map.hubspotId}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log('\nBackfill completado.');
}

main().catch(e => { console.error(e); process.exit(1); });
