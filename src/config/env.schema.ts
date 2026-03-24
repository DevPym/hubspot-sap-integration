/**
 * env.schema.ts — Schema Zod de variables de entorno (sin efectos secundarios).
 *
 * Este archivo exporta únicamente el schema y el tipo, sin parsear ni llamar
 * process.exit. De este modo puede importarse de forma segura en tests.
 *
 * Para obtener el objeto `env` validado en tiempo de ejecución,
 * usar: import { env } from './env'
 */

import { z } from 'zod';

export const envSchema = z.object({
  // --- Base de datos y caché ---
  DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL válida (ej: postgresql://...)'),
  REDIS_URL: z.string().url('REDIS_URL debe ser una URL válida (ej: redis:// o rediss://)'),

  // --- HubSpot ---
  HUBSPOT_ACCESS_TOKEN: z
    .string()
    .min(1, 'HUBSPOT_ACCESS_TOKEN es requerido')
    .startsWith('pat-', 'HUBSPOT_ACCESS_TOKEN debe comenzar con "pat-"'),
  HUBSPOT_CLIENT_SECRET: z.string().min(1, 'HUBSPOT_CLIENT_SECRET es requerido'),

  // --- SAP S/4HANA ---
  SAP_BASE_URL: z.string().url('SAP_BASE_URL debe ser una URL válida'),
  SAP_USERNAME: z.string().min(1, 'SAP_USERNAME es requerido'),
  SAP_PASSWORD: z.string().min(1, 'SAP_PASSWORD es requerido'),
  SAP_COMPANY_CODE: z.string().min(1, 'SAP_COMPANY_CODE es requerido'),
  SAP_BP_GROUPING: z.string().min(1, 'SAP_BP_GROUPING es requerido'),
  SAP_CORRESPONDENCE_LANGUAGE: z
    .string()
    .length(2, 'SAP_CORRESPONDENCE_LANGUAGE debe ser un código ISO de 2 letras (ej: ES)'),

  // --- Aplicación ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .regex(/^\d+$/, 'PORT debe ser un número entero')
    .transform(Number)
    .default('3000'),
  SYNC_LOCK_TIMEOUT_MS: z
    .string()
    .regex(/^\d+$/, 'SYNC_LOCK_TIMEOUT_MS debe ser un número entero (milisegundos)')
    .transform(Number)
    .default('30000'),
  MAX_RETRY_ATTEMPTS: z
    .string()
    .regex(/^\d+$/, 'MAX_RETRY_ATTEMPTS debe ser un número entero')
    .transform(Number)
    .default('5'),
  /** Intervalo de polling SAP en milisegundos (default: 5 minutos = 300000) */
  SAP_POLL_INTERVAL_MS: z
    .string()
    .regex(/^\d+$/, 'SAP_POLL_INTERVAL_MS debe ser un número entero (milisegundos)')
    .transform(Number)
    .default('300000'),
});

export type Env = z.infer<typeof envSchema>;
