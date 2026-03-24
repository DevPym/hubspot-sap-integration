/**
 * Tests para sync.worker.ts — Worker BullMQ de sincronización.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — factories autónomas (sin referenciar variables externas)
// ---------------------------------------------------------------------------

// Variable global para capturar el processor del Worker
let capturedProcessor: ((job: unknown) => Promise<unknown>) | null = null;
const workerOn = vi.fn();
const workerClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => {
  return {
    Queue: class MockQueue {
      name: string;
      add = vi.fn();
      close = vi.fn();
      constructor(name: string) { this.name = name; }
    },
    Worker: class MockWorker {
      on: typeof workerOn;
      close: typeof workerClose;
      constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
        capturedProcessor = processor;
        this.on = workerOn;
        this.close = workerClose;
      }
    },
  };
});

vi.mock('../src/config/env', () => ({
  env: {
    REDIS_URL: 'redis://localhost:6379',
    MAX_RETRY_ATTEMPTS: 5,
    PORT: 3000,
    NODE_ENV: 'test',
  },
}));

const mockSyncResult = vi.fn();
vi.mock('../src/services/sync.service', () => ({
  syncHubSpotToSap: (...args: unknown[]) => mockSyncResult(...args),
}));

vi.mock('../src/db/repositories/retryjob.repository', () => ({
  retryJobRepo: {
    create: vi.fn().mockResolvedValue({}),
    updateAttempt: vi.fn().mockResolvedValue({}),
    markExhausted: vi.fn().mockResolvedValue({}),
    findByBullmqJobId: vi.fn().mockResolvedValue(null),
    findPending: vi.fn().mockResolvedValue([]),
    findExhausted: vi.fn().mockResolvedValue([]),
  },
}));

// ---------------------------------------------------------------------------
// Import DESPUÉS de los mocks
// ---------------------------------------------------------------------------

import { createSyncWorker, closeSyncWorker, resetSyncWorker } from '../src/queue/sync.worker';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sync.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    resetSyncWorker();
  });

  describe('createSyncWorker()', () => {
    it('crea una instancia de Worker', () => {
      const worker = createSyncWorker();
      expect(worker).toBeDefined();
    });

    it('registra event handlers (completed, failed, error)', () => {
      createSyncWorker();
      const eventNames = workerOn.mock.calls.map((call: unknown[]) => call[0]);
      expect(eventNames).toContain('completed');
      expect(eventNames).toContain('failed');
      expect(eventNames).toContain('error');
    });

    it('retorna la misma instancia si ya existe (singleton)', () => {
      const worker1 = createSyncWorker();
      const worker2 = createSyncWorker();
      expect(worker1).toBe(worker2);
    });
  });

  describe('processJob (processor function)', () => {
    it('llama syncHubSpotToSap con los datos del job', async () => {
      createSyncWorker();
      expect(capturedProcessor).not.toBeNull();

      const mockJob = {
        id: 'test-job-1',
        data: {
          objectId: '12345',
          entityType: 'CONTACT',
          occurredAt: 1700000000000,
          subscriptionType: 'contact.propertyChange',
        },
        attemptsMade: 0,
      };

      mockSyncResult.mockResolvedValueOnce({
        success: true,
        operation: 'UPDATE',
        entityType: 'CONTACT',
        hubspotId: '12345',
        sapId: '100000050',
      });

      const result = await capturedProcessor!(mockJob);

      expect(mockSyncResult).toHaveBeenCalledWith(mockJob.data);
      expect(result).toEqual(expect.objectContaining({
        success: true,
        operation: 'UPDATE',
      }));
    });

    it('lanza error si sync.service retorna error (para reintento BullMQ)', async () => {
      createSyncWorker();

      const mockJob = {
        id: 'test-job-2',
        data: {
          objectId: '12345',
          entityType: 'CONTACT',
          occurredAt: 1700000000000,
          subscriptionType: 'contact.propertyChange',
        },
        attemptsMade: 0,
      };

      mockSyncResult.mockResolvedValueOnce({
        success: false,
        operation: 'UPDATE',
        entityType: 'CONTACT',
        hubspotId: '12345',
        error: 'SAP connection timeout',
      });

      await expect(capturedProcessor!(mockJob)).rejects.toThrow('SAP connection timeout');
    });

    it('retorna resultado SKIPPED sin lanzar error', async () => {
      createSyncWorker();

      const mockJob = {
        id: 'test-job-3',
        data: {
          objectId: '12345',
          entityType: 'CONTACT',
          occurredAt: 1700000000000,
          subscriptionType: 'contact.propertyChange',
        },
        attemptsMade: 0,
      };

      mockSyncResult.mockResolvedValueOnce({
        success: false,
        operation: 'SKIPPED',
        entityType: 'CONTACT',
        hubspotId: '12345',
        reason: 'Anti-loop: sync en progreso',
      });

      const result = await capturedProcessor!(mockJob);
      expect(result).toEqual(expect.objectContaining({
        operation: 'SKIPPED',
      }));
    });
  });

  describe('closeSyncWorker()', () => {
    it('cierra el worker', async () => {
      createSyncWorker();
      await closeSyncWorker();
      expect(workerClose).toHaveBeenCalled();
    });

    it('no falla si el worker no existe', async () => {
      await closeSyncWorker(); // No se creó worker
      expect(workerClose).not.toHaveBeenCalled();
    });
  });
});
