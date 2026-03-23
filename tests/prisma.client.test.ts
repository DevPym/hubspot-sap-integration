/**
 * Tests para src/db/prisma.client.ts
 *
 * Verifica que el módulo exporta una instancia de PrismaClient.
 */
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — deben estar DENTRO del factory para evitar hoisting issues
// ---------------------------------------------------------------------------

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class PrismaPgMock {
    constructor(_opts: unknown) { /* mock */ }
  },
}));

vi.mock('../src/generated/prisma/client', () => ({
  PrismaClient: class PrismaClientMock {
    idMap = { findUnique: vi.fn(), create: vi.fn() };
    syncLog = { create: vi.fn(), findMany: vi.fn() };
    retryJob = { create: vi.fn() };
    $connect = vi.fn();
    $disconnect = vi.fn();
    constructor(_opts?: unknown) { /* mock */ }
  },
}));

import { prisma } from '../src/db/prisma.client';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prisma.client — Singleton', () => {
  it('exporta una instancia de PrismaClient', () => {
    expect(prisma).toBeDefined();
  });

  it('la instancia tiene acceso a los modelos IdMap, SyncLog, RetryJob', () => {
    expect(prisma.idMap).toBeDefined();
    expect(prisma.syncLog).toBeDefined();
    expect(prisma.retryJob).toBeDefined();
  });

  it('importar dos veces retorna la misma instancia (singleton)', async () => {
    const { prisma: prisma2 } = await import('../src/db/prisma.client');
    expect(prisma2).toBe(prisma);
  });
});
