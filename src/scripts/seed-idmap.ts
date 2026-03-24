/**
 * seed-idmap.ts — Pre-carga el id_map con los mapeos conocidos entre HubSpot y SAP.
 *
 * Ejecutar: npx tsx src/scripts/seed-idmap.ts
 *
 * Estos son los objetos que ya existen en AMBOS sistemas y deben estar
 * vinculados para que las actualizaciones funcionen como UPDATE (no CREATE).
 */

import 'dotenv/config';
import { prisma } from '../db/prisma.client';

// Mapeos conocidos (verificados en CLAUDE.md y pruebas de integración)
const SEED_DATA = [
  {
    entityType: 'CONTACT' as const,
    hubspotId: '210581802294',  // Max Power Test
    sapId: '100000031',          // Juan Pérez Test (BP Persona)
  },
  {
    entityType: 'COMPANY' as const,
    hubspotId: '53147869965',   // Empresa Test SAP Integration
    sapId: '100000030',          // Empresa Test desde HubSpot (BP Org)
  },
  {
    entityType: 'DEAL' as const,
    hubspotId: '58247306498',   // Deal Test SAP Integration
    sapId: '49',                 // Sales Order 49
  },
];

async function main() {
  console.log('Seeding id_map con mapeos conocidos...\n');

  for (const mapping of SEED_DATA) {
    try {
      const existing = await prisma.idMap.findFirst({
        where: {
          OR: [
            { entityType: mapping.entityType, hubspotId: mapping.hubspotId },
            { entityType: mapping.entityType, sapId: mapping.sapId },
          ],
        },
      });

      if (existing) {
        console.log(`  ⏭️  ${mapping.entityType} ya existe: HS:${existing.hubspotId} ↔ SAP:${existing.sapId}`);
        continue;
      }

      await prisma.idMap.create({
        data: {
          entityType: mapping.entityType,
          hubspotId: mapping.hubspotId,
          sapId: mapping.sapId,
          syncInProgress: false,
        },
      });

      console.log(`  ✅ ${mapping.entityType} creado: HS:${mapping.hubspotId} ↔ SAP:${mapping.sapId}`);
    } catch (error) {
      console.error(`  ❌ ${mapping.entityType} error:`, error instanceof Error ? error.message : error);
    }
  }

  console.log('\nSeed completado.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Error fatal:', e);
  process.exit(1);
});
