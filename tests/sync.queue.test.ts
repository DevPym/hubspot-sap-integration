/**
 * Tests para sync.queue.ts — Cola BullMQ de sincronización.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HubSpotSyncEvent } from '../src/services/sync.service';

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories no pueden referenciar variables externas
// ---------------------------------------------------------------------------

vi.mock('bullmq', () => {
  const add = vi.fn().mockResolvedValue({ id: 'test-job-id' });
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    Queue: class MockQueue {
      name: string;
      add = add;
      close = close;
      constructor(name: string) { this.name = name; }
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

// ---------------------------------------------------------------------------
// Import DESPUÉS de los mocks
// ---------------------------------------------------------------------------

import { syncQueue, addSyncJob, closeSyncQueue, QUEUE_NAME } from '../src/queue/sync.queue';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sync.queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('QUEUE_NAME', () => {
    it('exporta el nombre correcto de la cola', () => {
      expect(QUEUE_NAME).toBe('hubspot-sap-sync');
    });
  });

  describe('syncQueue', () => {
    it('crea una instancia de Queue con el nombre correcto', () => {
      expect(syncQueue).toBeDefined();
      expect(syncQueue.name).toBe('hubspot-sap-sync');
    });
  });

  describe('addSyncJob()', () => {
    const testEvent: HubSpotSyncEvent = {
      objectId: '12345',
      entityType: 'CONTACT',
      occurredAt: 1700000000000,
      subscriptionType: 'contact.propertyChange',
    };

    it('encola un evento con jobId de deduplicación', async () => {
      await addSyncJob(testEvent);

      expect(syncQueue.add).toHaveBeenCalledWith(
        'contact.propertyChange',
        testEvent,
        expect.objectContaining({
          jobId: 'CONTACT-12345-1700000000000',
        }),
      );
    });

    it('genera jobId único basado en entityType-objectId-occurredAt', async () => {
      await addSyncJob(testEvent);

      const calledOptions = (syncQueue.add as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(calledOptions.jobId).toBe('CONTACT-12345-1700000000000');
    });

    it('permite opciones adicionales de BullMQ', async () => {
      await addSyncJob(testEvent, { priority: 1 });

      const calledOptions = (syncQueue.add as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(calledOptions.priority).toBe(1);
      expect(calledOptions.jobId).toBe('CONTACT-12345-1700000000000');
    });

    it('maneja diferentes tipos de entidad', async () => {
      const dealEvent: HubSpotSyncEvent = {
        objectId: '99999',
        entityType: 'DEAL',
        occurredAt: 1700000001000,
        subscriptionType: 'deal.creation',
      };

      await addSyncJob(dealEvent);

      expect(syncQueue.add).toHaveBeenCalledWith(
        'deal.creation',
        dealEvent,
        expect.objectContaining({
          jobId: 'DEAL-99999-1700000001000',
        }),
      );
    });

    it('retorna el job creado', async () => {
      const result = await addSyncJob(testEvent);
      expect(result).toEqual({ id: 'test-job-id' });
    });
  });

  describe('closeSyncQueue()', () => {
    it('cierra la cola', async () => {
      await closeSyncQueue();
      expect(syncQueue.close).toHaveBeenCalled();
    });
  });
});
