/**
 * Tests extendidos para sync.worker.ts — Gaps de cobertura.
 *
 * Verifica:
 * - MissingDependencyError propaga al BullMQ (no se convierte en error genérico)
 * - Failed event handler: primera falla crea retry_job
 * - Failed event handler: último intento marca exhausted
 * - Failed event handler: MissingDependencyError con logging diferenciado
 * - Error handler: logs de error Redis
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let capturedProcessor: ((job: unknown) => Promise<unknown>) | null = null;
const workerOn = vi.fn();
const workerClose = vi.fn().mockResolvedValue(undefined);

// Capturar los event handlers registrados
const eventHandlers: Record<string, (...args: unknown[]) => void> = {};

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
        this.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          eventHandlers[event] = handler;
          workerOn(event, handler);
        });
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
vi.mock('../src/services/sync.service', () => {
  class MockMissingDependencyError extends Error {
    readonly code = 'MISSING_COMPANY';
    readonly retriable = true;
    constructor(message: string) {
      super(message);
      this.name = 'MissingDependencyError';
    }
  }
  return {
    syncHubSpotToSap: (...args: unknown[]) => mockSyncResult(...args),
    MissingDependencyError: MockMissingDependencyError,
  };
});

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

import { createSyncWorker, resetSyncWorker } from '../src/queue/sync.worker';
import { retryJobRepo } from '../src/db/repositories/retryjob.repository';

// Alias for cleaner test assertions
const mockRetryJobRepo = retryJobRepo as {
  create: ReturnType<typeof vi.fn>;
  updateAttempt: ReturnType<typeof vi.fn>;
  markExhausted: ReturnType<typeof vi.fn>;
  findByBullmqJobId: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedProcessor = null;
  Object.keys(eventHandlers).forEach((k) => delete eventHandlers[k]);
  resetSyncWorker();
});

// ---------------------------------------------------------------------------
// MissingDependencyError en processor
// ---------------------------------------------------------------------------

describe('sync.worker — MissingDependencyError', () => {
  it('propaga MissingDependencyError al lanzarse desde syncHubSpotToSap', async () => {
    createSyncWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockJob = {
      id: 'job-dep-1',
      data: {
        objectId: '58247306498',
        entityType: 'DEAL',
        occurredAt: 1700000000000,
        subscriptionType: 'deal.creation',
      },
      attemptsMade: 0,
    };

    // syncHubSpotToSap lanza MissingDependencyError (re-throw de sync.service)
    const { MissingDependencyError } = await import('../src/services/sync.service');
    mockSyncResult.mockRejectedValueOnce(
      new MissingDependencyError('Company asociada al Deal 58247306498 no encontrada en id_map'),
    );

    await expect(capturedProcessor!(mockJob)).rejects.toThrow(
      'Company asociada al Deal 58247306498 no encontrada en id_map',
    );
  });
});

// ---------------------------------------------------------------------------
// Failed event handler
// ---------------------------------------------------------------------------

describe('sync.worker — failed event handler', () => {
  it('crea retry_job en primera falla', async () => {
    createSyncWorker();

    const failedHandler = eventHandlers['failed'];
    expect(failedHandler).toBeDefined();

    const mockJob = {
      id: 'job-fail-1',
      data: { objectId: '12345', entityType: 'CONTACT', occurredAt: 1700000000000, subscriptionType: 'contact.creation' },
      attemptsMade: 1,
    };

    mockRetryJobRepo.findByBullmqJobId.mockResolvedValue(null); // Primera falla

    await failedHandler(mockJob, new Error('SAP timeout'));

    expect(mockRetryJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bullmqJobId: 'job-fail-1',
        payload: mockJob.data,
        maxAttempts: 5,
      }),
    );
  });

  it('marca exhausted en último intento', async () => {
    createSyncWorker();

    const failedHandler = eventHandlers['failed'];
    const mockJob = {
      id: 'job-exhaust-1',
      data: { objectId: '12345', entityType: 'CONTACT', occurredAt: 1700000000000, subscriptionType: 'contact.creation' },
      attemptsMade: 5, // == MAX_RETRY_ATTEMPTS → último intento
    };

    mockRetryJobRepo.findByBullmqJobId.mockResolvedValue({ id: 'existing' }); // Ya existe

    await failedHandler(mockJob, new Error('Persistent error'));

    expect(mockRetryJobRepo.markExhausted).toHaveBeenCalledWith(
      'job-exhaust-1',
      'Persistent error',
    );
  });

  it('actualiza retry_job en reintentos intermedios', async () => {
    createSyncWorker();

    const failedHandler = eventHandlers['failed'];
    const mockJob = {
      id: 'job-retry-1',
      data: { objectId: '12345', entityType: 'CONTACT', occurredAt: 1700000000000, subscriptionType: 'contact.creation' },
      attemptsMade: 2, // Intermedio
    };

    mockRetryJobRepo.findByBullmqJobId.mockResolvedValue({ id: 'existing' }); // Ya existe

    await failedHandler(mockJob, new Error('Transient error'));

    expect(mockRetryJobRepo.updateAttempt).toHaveBeenCalledWith(
      'job-retry-1',
      'Transient error',
      expect.any(Date),
    );
  });

  it('logging diferenciado para MissingDependencyError (no es error, es espera)', async () => {
    createSyncWorker();

    const failedHandler = eventHandlers['failed'];
    const mockJob = {
      id: 'job-missing-1',
      data: { objectId: '58247306498', entityType: 'DEAL', occurredAt: 1700000000000, subscriptionType: 'deal.creation' },
      attemptsMade: 1, // No es último intento
    };

    const consoleSpy = vi.spyOn(console, 'log');

    // Error con mensaje que incluye 'no encontrada en id_map'
    await failedHandler(mockJob, new Error('Company no encontrada en id_map'));

    // Debe usar console.log (no console.error) para dependency esperada
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('esperando dependencia'),
    );

    consoleSpy.mockRestore();
  });

  it('no falla si job es null en failed event', async () => {
    createSyncWorker();

    const failedHandler = eventHandlers['failed'];

    // No debe lanzar excepción
    await expect(
      Promise.resolve(failedHandler(null, new Error('test'))),
    ).resolves.not.toThrow();

    expect(mockRetryJobRepo.create).not.toHaveBeenCalled();
  });

  it('no interrumpe si PostgreSQL falla al guardar retry_job', async () => {
    createSyncWorker();

    const failedHandler = eventHandlers['failed'];
    const mockJob = {
      id: 'job-db-fail',
      data: { objectId: '12345', entityType: 'CONTACT', occurredAt: 1700000000000, subscriptionType: 'contact.creation' },
      attemptsMade: 1,
    };

    mockRetryJobRepo.findByBullmqJobId.mockRejectedValue(new Error('DB connection lost'));

    const consoleSpy = vi.spyOn(console, 'error');

    // No debe lanzar
    await expect(
      Promise.resolve(failedHandler(mockJob, new Error('test'))),
    ).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error guardando retry_job'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Completed event handler
// ---------------------------------------------------------------------------

describe('sync.worker — completed event handler', () => {
  it('loguea completion sin errores', async () => {
    createSyncWorker();

    const completedHandler = eventHandlers['completed'];
    expect(completedHandler).toBeDefined();

    const consoleSpy = vi.spyOn(console, 'log');

    completedHandler({ id: 'job-ok-1' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('job-ok-1'),
    );

    consoleSpy.mockRestore();
  });

  it('no falla si job es null', () => {
    createSyncWorker();

    const completedHandler = eventHandlers['completed'];

    // No debe lanzar
    expect(() => completedHandler(null)).not.toThrow();
  });
});
