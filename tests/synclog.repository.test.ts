/**
 * Tests para src/db/repositories/synclog.repository.ts
 *
 * Testea las funciones de auditoría del repositorio SyncLog
 * usando mocks de Prisma (sin conexión real a base de datos).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de prisma.client.ts — mockea el módulo directamente
// ---------------------------------------------------------------------------

vi.mock('../src/db/prisma.client', () => ({
  prisma: {
    syncLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock de Prisma namespace para JsonNull
vi.mock('../src/generated/prisma/client', () => ({
  Prisma: { JsonNull: '__prisma_json_null__' },
}));

// Importar después del mock
import { prisma } from '../src/db/prisma.client';
import * as synclogRepo from '../src/db/repositories/synclog.repository';

// Acceso tipado al mock
const mockSyncLog = prisma.syncLog as {
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('synclog.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create()', () => {
    it('inserta un registro de auditoría completo', async () => {
      const input = {
        idMapId: 'uuid-1',
        entityType: 'CONTACT' as const,
        operation: 'CREATE' as const,
        sourceSystem: 'HUBSPOT' as const,
        targetSystem: 'SAP' as const,
        status: 'SUCCESS' as const,
        inboundPayload: { objectId: '210581802294', propertyName: 'firstname' },
        outboundPayload: { FirstName: 'Juan' },
        attemptNumber: 1,
      };

      const createdRecord = { id: 'log-uuid-1', ...input, createdAt: new Date() };
      mockSyncLog.create.mockResolvedValueOnce(createdRecord);

      const result = await synclogRepo.create(input);

      expect(mockSyncLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idMapId: 'uuid-1',
          entityType: 'CONTACT',
          operation: 'CREATE',
          sourceSystem: 'HUBSPOT',
          targetSystem: 'SAP',
          status: 'SUCCESS',
          inboundPayload: input.inboundPayload,
          outboundPayload: input.outboundPayload,
          errorMessage: null,
          errorCode: null,
          attemptNumber: 1,
        }),
      });
      expect(result.id).toBe('log-uuid-1');
    });

    it('inserta registro sin idMapId (antes de crear el mapping)', async () => {
      const input = {
        entityType: 'COMPANY' as const,
        operation: 'CREATE' as const,
        sourceSystem: 'HUBSPOT' as const,
        targetSystem: 'SAP' as const,
        status: 'PENDING' as const,
        inboundPayload: { objectId: '53147869965' },
      };

      mockSyncLog.create.mockResolvedValueOnce({ id: 'log-uuid-2', ...input });

      await synclogRepo.create(input);

      expect(mockSyncLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idMapId: null,
          errorMessage: null,
          errorCode: null,
          attemptNumber: 1,
        }),
      });
    });

    it('inserta registro con error', async () => {
      const input = {
        idMapId: 'uuid-1',
        entityType: 'DEAL' as const,
        operation: 'UPDATE' as const,
        sourceSystem: 'SAP' as const,
        targetSystem: 'HUBSPOT' as const,
        status: 'FAILED' as const,
        inboundPayload: { SalesOrder: '49' },
        errorMessage: 'HubSpot API returned 429',
        errorCode: 'RATE_LIMITED',
        attemptNumber: 3,
      };

      mockSyncLog.create.mockResolvedValueOnce({ id: 'log-uuid-3', ...input });

      await synclogRepo.create(input);

      expect(mockSyncLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorMessage: 'HubSpot API returned 429',
          errorCode: 'RATE_LIMITED',
          attemptNumber: 3,
        }),
      });
    });
  });

  describe('findByIdMap()', () => {
    it('retorna historial ordenado por fecha descendente', async () => {
      const mockLogs = [
        { id: 'log-2', status: 'SUCCESS', createdAt: new Date('2024-01-15') },
        { id: 'log-1', status: 'PENDING', createdAt: new Date('2024-01-14') },
      ];
      mockSyncLog.findMany.mockResolvedValueOnce(mockLogs);

      const result = await synclogRepo.findByIdMap('uuid-1');

      expect(mockSyncLog.findMany).toHaveBeenCalledWith({
        where: { idMapId: 'uuid-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      expect(result).toHaveLength(2);
    });

    it('respeta el límite personalizado', async () => {
      mockSyncLog.findMany.mockResolvedValueOnce([]);

      await synclogRepo.findByIdMap('uuid-1', 5);

      expect(mockSyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('findRecent()', () => {
    it('retorna los registros más recientes con relación idMap', async () => {
      mockSyncLog.findMany.mockResolvedValueOnce([]);

      await synclogRepo.findRecent(10);

      expect(mockSyncLog.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { idMap: true },
      });
    });

    it('usa límite por defecto de 50', async () => {
      mockSyncLog.findMany.mockResolvedValueOnce([]);

      await synclogRepo.findRecent();

      expect(mockSyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });
});
