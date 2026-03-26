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

  // --- SAP S/4HANA — Conexión ---
  SAP_BASE_URL: z.string().url('SAP_BASE_URL debe ser una URL válida'),
  SAP_USERNAME: z.string().min(1, 'SAP_USERNAME es requerido'),
  SAP_PASSWORD: z.string().min(1, 'SAP_PASSWORD es requerido'),

  // --- SAP S/4HANA — Business Partner ---
  SAP_COMPANY_CODE: z.string().min(1).default('4610'),
  SAP_BP_GROUPING: z.string().min(1).default('BP02'),
  SAP_CORRESPONDENCE_LANGUAGE: z.string().length(2).default('ES'),
  /** Cuenta contable de conciliación de deudores (plan de cuentas SAP) */
  SAP_RECONCILIATION_ACCOUNT: z.string().min(1).default('10200600'),
  /** Tipo de número fiscal. CO3=RUT Chile (verificado prod), CL1=alternativo */
  SAP_TAX_TYPE: z.string().min(1).default('CO3'),
  /** Roles BP separados por coma. FLCU00=cliente general, FLCU01=cliente ventas */
  SAP_BP_ROLES: z.string().min(1).default('FLCU00,FLCU01'),
  /** Condición de pago por defecto. NT00=inmediato, NT30=30 días, NT60=60 días */
  SAP_DEFAULT_PAYMENT_TERMS: z.string().min(1).default('NT30'),

  // --- SAP S/4HANA — Sales Order ---
  /** Tipo de orden de venta. OR=orden estándar */
  SAP_SALES_ORDER_TYPE: z.string().min(1).default('OR'),
  /** Organización de ventas. 4601=principal, 4602=secundaria */
  SAP_SALES_ORGANIZATION: z.string().min(1).default('4601'),
  /** Canal de distribución */
  SAP_DISTRIBUTION_CHANNEL: z.string().min(1).default('CF'),
  /** División/sector */
  SAP_ORGANIZATION_DIVISION: z.string().min(1).default('10'),
  /** Material por defecto para ítems. Q01=producto químico litros, S001=servicio horas */
  SAP_DEFAULT_MATERIAL: z.string().min(1).default('Q01'),
  /** Unidad de medida del material. L=litros, KG=kilos, H=horas, UN=unidades */
  SAP_DEFAULT_MATERIAL_UNIT: z.string().min(1).default('L'),

  // --- Defaults generales ---
  /** Moneda por defecto. CLP=peso chileno, USD=dólar */
  SAP_DEFAULT_CURRENCY: z.string().length(3).default('CLP'),
  /** País por defecto ISO 2 letras */
  SAP_DEFAULT_COUNTRY: z.string().length(2).default('CL'),

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
