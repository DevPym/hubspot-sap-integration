/**
 * Tests para src/config/env.ts
 *
 * Se importa `envSchema` (no `env`) para evitar que el `process.exit(1)`
 * del módulo corte el proceso de Vitest cuando las vars no están definidas.
 */
import { describe, it, expect } from 'vitest';
// Importar desde env.schema (sin efectos secundarios) para evitar process.exit en tests
import { envSchema } from '../src/config/env.schema';

// ---------------------------------------------------------------------------
// Datos base válidos para reutilizar en múltiples tests
// ---------------------------------------------------------------------------

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
  REDIS_URL: 'redis://localhost:6379',
  HUBSPOT_ACCESS_TOKEN: 'pat-na1-test-token-12345',
  HUBSPOT_CLIENT_SECRET: 'secret123',
  SAP_BASE_URL: 'https://my426851-api.s4hana.cloud.sap/sap/opu/odata/sap',
  SAP_USERNAME: 'CPI_INTEGRATIONS',
  SAP_PASSWORD: 'password123',
  SAP_COMPANY_CODE: '4610',
  SAP_BP_GROUPING: 'BP02',
  SAP_CORRESPONDENCE_LANGUAGE: 'ES',
  NODE_ENV: 'test',
  PORT: '3000',
  SYNC_LOCK_TIMEOUT_MS: '30000',
  MAX_RETRY_ATTEMPTS: '5',
};

// ---------------------------------------------------------------------------
// Tests de validación exitosa
// ---------------------------------------------------------------------------

describe('envSchema — validación exitosa', () => {
  it('acepta todas las variables con valores válidos', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it('transforma PORT de string a number', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
      expect(typeof result.data.PORT).toBe('number');
    }
  });

  it('transforma SYNC_LOCK_TIMEOUT_MS de string a number', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SYNC_LOCK_TIMEOUT_MS).toBe(30000);
    }
  });

  it('transforma MAX_RETRY_ATTEMPTS de string a number', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MAX_RETRY_ATTEMPTS).toBe(5);
    }
  });

  it('acepta NODE_ENV como "development"', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'development' });
    expect(result.success).toBe(true);
  });

  it('acepta NODE_ENV como "production"', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'production' });
    expect(result.success).toBe(true);
  });

  it('usa "development" como valor por defecto si NODE_ENV no está definido', () => {
    const { NODE_ENV: _, ...withoutNodeEnv } = validEnv;
    const result = envSchema.safeParse(withoutNodeEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
    }
  });

  it('usa "3000" como PORT por defecto si no está definido', () => {
    const { PORT: _, ...withoutPort } = validEnv;
    const result = envSchema.safeParse(withoutPort);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests de validación fallida
// ---------------------------------------------------------------------------

describe('envSchema — validación fallida', () => {
  it('falla con objeto vacío', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('falla si DATABASE_URL no es una URL válida', () => {
    const result = envSchema.safeParse({ ...validEnv, DATABASE_URL: 'no-es-una-url' });
    expect(result.success).toBe(false);
  });

  it('falla si REDIS_URL no es una URL válida', () => {
    const result = envSchema.safeParse({ ...validEnv, REDIS_URL: 'no-es-una-url' });
    expect(result.success).toBe(false);
  });

  it('falla si HUBSPOT_ACCESS_TOKEN no comienza con "pat-"', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      HUBSPOT_ACCESS_TOKEN: 'token-sin-pat-prefix',
    });
    expect(result.success).toBe(false);
  });

  it('falla si SAP_CORRESPONDENCE_LANGUAGE tiene más de 2 caracteres', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      SAP_CORRESPONDENCE_LANGUAGE: 'ESP',
    });
    expect(result.success).toBe(false);
  });

  it('falla si SAP_CORRESPONDENCE_LANGUAGE tiene menos de 2 caracteres', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      SAP_CORRESPONDENCE_LANGUAGE: 'E',
    });
    expect(result.success).toBe(false);
  });

  it('falla si NODE_ENV tiene un valor no permitido', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
  });

  it('falla si PORT no es un número entero', () => {
    const result = envSchema.safeParse({ ...validEnv, PORT: 'abc' });
    expect(result.success).toBe(false);
  });

  it('falla si falta SAP_PASSWORD', () => {
    const { SAP_PASSWORD: _, ...withoutSapPwd } = validEnv;
    const result = envSchema.safeParse(withoutSapPwd);
    expect(result.success).toBe(false);
  });
});
