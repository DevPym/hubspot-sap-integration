/**
 * Tests para retryjob.repository.ts — Persistencia de reintentos.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de Prisma — factory autónoma
// ---------------------------------------------------------------------------

vi.mock('../src/db/prisma.client', () => ({
  prisma: {
    retryJob: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Import DESPUÉS del mock
// ---------------------------------------------------------------------------

import { retryJobRepo } from '../src/db/repositories/retryjob.repository';
import { prisma } from '../src/db/prisma.client';

// Alias tipado para el mock
const mockRetryJob = prisma.retryJob as unknown as {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('retryJobRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create()', () => {
    it('registra un job fallido con datos completos', async () => {
      const data = {
        bullmqJobId: 'job-123',
        payload: { objectId: '12345', entityType: 'CONTACT' },
        maxAttempts: 5,
        nextRetryAt: new Date('2024-01-15T10:00:00Z'),
      };

      mockRetryJob.create.mockResolvedValueOnce({
        id: 'uuid-1',
        ...data,
        attemptCount: 1,
        exhausted: false,
      });

      const result = await retryJobRepo.create(data);

      expect(mockRetryJob.create).toHaveBeenCalledWith({
        data: {
          bullmqJobId: 'job-123',
          payload: data.payload,
          maxAttempts: 5,
          attemptCount: 1,
          nextRetryAt: data.nextRetryAt,
        },
      });
      expect(result.attemptCount).toBe(1);
      expect(result.exhausted).toBe(false);
    });
  });

  describe('updateAttempt()', () => {
    it('incrementa attemptCount y actualiza error', async () => {
      mockRetryJob.update.mockResolvedValueOnce({
        id: 'uuid-1',
        bullmqJobId: 'job-123',
        attemptCount: 2,
        lastError: 'SAP timeout',
      });

      const nextRetry = new Date('2024-01-15T10:05:00Z');
      await retryJobRepo.updateAttempt('job-123', 'SAP timeout', nextRetry);

      expect(mockRetryJob.update).toHaveBeenCalledWith({
        where: { bullmqJobId: 'job-123' },
        data: {
          attemptCount: { increment: 1 },
          lastError: 'SAP timeout',
          nextRetryAt: nextRetry,
        },
      });
    });
  });

  describe('markExhausted()', () => {
    it('marca el job como exhausted con el último error', async () => {
      mockRetryJob.update.mockResolvedValueOnce({
        id: 'uuid-1',
        bullmqJobId: 'job-123',
        exhausted: true,
        lastError: 'SAP permanently down',
      });

      await retryJobRepo.markExhausted('job-123', 'SAP permanently down');

      expect(mockRetryJob.update).toHaveBeenCalledWith({
        where: { bullmqJobId: 'job-123' },
        data: {
          exhausted: true,
          lastError: 'SAP permanently down',
        },
      });
    });
  });

  describe('findByBullmqJobId()', () => {
    it('busca por bullmqJobId', async () => {
      mockRetryJob.findUnique.mockResolvedValueOnce({
        id: 'uuid-1',
        bullmqJobId: 'job-123',
        attemptCount: 3,
      });

      const result = await retryJobRepo.findByBullmqJobId('job-123');

      expect(mockRetryJob.findUnique).toHaveBeenCalledWith({
        where: { bullmqJobId: 'job-123' },
      });
      expect(result?.attemptCount).toBe(3);
    });

    it('retorna null si no existe', async () => {
      mockRetryJob.findUnique.mockResolvedValueOnce(null);

      const result = await retryJobRepo.findByBullmqJobId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findPending()', () => {
    it('retorna jobs no exhausted ordenados por nextRetryAt', async () => {
      mockRetryJob.findMany.mockResolvedValueOnce([
        { bullmqJobId: 'job-1', exhausted: false },
        { bullmqJobId: 'job-2', exhausted: false },
      ]);

      const result = await retryJobRepo.findPending();

      expect(mockRetryJob.findMany).toHaveBeenCalledWith({
        where: { exhausted: false },
        orderBy: { nextRetryAt: 'asc' },
        take: 50,
      });
      expect(result).toHaveLength(2);
    });

    it('acepta límite personalizado', async () => {
      mockRetryJob.findMany.mockResolvedValueOnce([]);
      await retryJobRepo.findPending(10);

      expect(mockRetryJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('findExhausted()', () => {
    it('retorna jobs exhausted ordenados por updatedAt desc', async () => {
      mockRetryJob.findMany.mockResolvedValueOnce([
        { bullmqJobId: 'job-dead-1', exhausted: true },
      ]);

      const result = await retryJobRepo.findExhausted();

      expect(mockRetryJob.findMany).toHaveBeenCalledWith({
        where: { exhausted: true },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      expect(result).toHaveLength(1);
    });
  });
});
