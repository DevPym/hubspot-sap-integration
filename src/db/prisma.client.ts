/**
 * prisma.client.ts — Singleton de PrismaClient.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Exportar UNA sola instancia de PrismaClient para toda la app       │
 * │  2. Evitar múltiples conexiones a PostgreSQL (agotaría el pool)        │
 * │  3. En desarrollo (tsx watch), usar globalThis para sobrevivir HMR     │
 * │  4. En producción, crear la instancia directamente (sin globalThis)    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Lee:                                                                   │
 * │    - DATABASE_URL del entorno (Railway PostgreSQL)                      │
 * │                                                                         │
 * │  Lo importan:                                                           │
 * │    - src/db/repositories/idmap.repository.ts                            │
 * │    - src/db/repositories/synclog.repository.ts                          │
 * │    - src/services/sync.service.ts (Fase 5)                              │
 * │    - src/index.ts (para $disconnect en shutdown)                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PRISMA 7 — ADAPTER PATTERN                                             │
 * │  ─────────────────────────────                                          │
 * │  Prisma 7 ya no acepta `url` en schema.prisma ni en el constructor.    │
 * │  En su lugar, se usa un adapter (@prisma/adapter-pg) que recibe la     │
 * │  connectionString directamente. La URL de migración se configura en    │
 * │  prisma.config.ts (solo para CLI de Prisma, no para runtime).          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PATRÓN SINGLETON CON GLOBALTHIS                                        │
 * │  ───────────────────────────────                                        │
 * │  En desarrollo, tsx watch (hot-reload) recarga módulos pero mantiene   │
 * │  el objeto global. Sin globalThis, cada recarga crearía un nuevo       │
 * │  PrismaClient → múltiples conexiones → warning de Prisma.              │
 * │                                                                         │
 * │  En producción, el módulo se carga UNA vez, así que globalThis no      │
 * │  es estrictamente necesario, pero lo usamos por consistencia.          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ---------------------------------------------------------------------------
// Extensión de globalThis para TypeScript
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// ---------------------------------------------------------------------------
// Adapter — conexión directa a PostgreSQL via pg
// ---------------------------------------------------------------------------

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['error'],
  });
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Instancia única de PrismaClient.
 *
 * - En desarrollo: reutiliza la instancia almacenada en globalThis
 * - En producción: crea una instancia nueva (el módulo solo se carga una vez)
 *
 * Uso:
 *   import { prisma } from '../db/prisma.client';
 *   const user = await prisma.idMap.findUnique({ where: { hubspotId: '123' } });
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

// En desarrollo, guardar en globalThis para sobrevivir hot-reload
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
