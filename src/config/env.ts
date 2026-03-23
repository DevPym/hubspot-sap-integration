/**
 * env.ts — Validación y exportación de variables de entorno.
 *
 * Este módulo es el único punto de acceso a `process.env` en runtime.
 * Si alguna variable obligatoria falta o tiene formato incorrecto, el proceso
 * termina de inmediato con un mensaje descriptivo (fail-fast).
 *
 * Uso en otros módulos:
 *   import { env } from '../config/env';
 *   env.SAP_BASE_URL  // string validado
 *   env.PORT          // number (transformado desde string)
 *
 * Para tests que necesiten el schema sin efectos secundarios:
 *   import { envSchema } from '../config/env.schema';
 */

import dotenv from 'dotenv';
import { envSchema } from './env.schema';

export type { Env } from './env.schema';
export { envSchema } from './env.schema';

// Cargar .env antes de parsear process.env.
// dotenv.config() es idempotente: no sobreescribe variables ya definidas.
dotenv.config();

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[config] ❌ Variables de entorno inválidas o faltantes:');
  const errors = parsed.error.flatten().fieldErrors;
  for (const [field, messages] of Object.entries(errors)) {
    console.error(`  - ${field}: ${messages?.join(', ')}`);
  }
  process.exit(1);
}

/**
 * Objeto con todas las variables de entorno validadas y transformadas.
 * PORT, SYNC_LOCK_TIMEOUT_MS y MAX_RETRY_ATTEMPTS son `number`.
 */
export const env = parsed.data;
