/**
 * Tests para src/db/repositories/idmap.repository.ts
 *
 * Testea las funciones CRUD y anti-bucle del repositorio IdMap
 * usando mocks de Prisma (sin conexión real a base de datos).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de prisma.client.ts — mockea el módulo directamente
// ---------------------------------------------------------------------------

vi.mock('../src/db/prisma.client', () => ({
  prisma: {
    idMap: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Importar después del mock
import { prisma } from '../src/db/prisma.client';
import * as idmapRepo from '../src/db/repositories/idmap.repository';

// Acceso tipado al mock
const mockIdMap = prisma.idMap as {
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('idmap.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findByHubSpotId()', () => {
    it('busca mapping por entityType + hubspotId', async () => {
      const mockRecord = {
        id: 'uuid-1',
        entityType: 'CONTACT',
        hubspotId: '210581802294',
        sapId: '100000031',
        syncInProgress: false,
        syncInitiatedBy: null,
        syncStartedAt: null,
      };
      mockIdMap.findUnique.mockResolvedValueOnce(mockRecord);

      const result = await idmapRepo.findByHubSpotId('CONTACT' as never, '210581802294');

      expect(mockIdMap.findUnique).toHaveBeenCalledWith({
        where: {
          entityType_hubspotId: { entityType: 'CONTACT', hubspotId: '210581802294' },
        },
      });
      expect(result).toEqual(mockRecord);
    });

    it('retorna null si no existe el mapping', async () => {
      mockIdMap.findUnique.mockResolvedValueOnce(null);

      const result = await idmapRepo.findByHubSpotId('CONTACT' as never, '999999');

      expect(result).toBeNull();
    });
  });

  describe('findBySapId()', () => {
    it('busca mapping por entityType + sapId', async () => {
      const mockRecord = {
        id: 'uuid-2',
        entityType: 'COMPANY',
        hubspotId: '53147869965',
        sapId: '100000030',
      };
      mockIdMap.findUnique.mockResolvedValueOnce(mockRecord);

      const result = await idmapRepo.findBySapId('COMPANY' as never, '100000030');

      expect(mockIdMap.findUnique).toHaveBeenCalledWith({
        where: {
          entityType_sapId: { entityType: 'COMPANY', sapId: '100000030' },
        },
      });
      expect(result).toEqual(mockRecord);
    });
  });

  describe('create()', () => {
    it('crea un nuevo mapping HubSpot ↔ SAP', async () => {
      const newMapping = {
        entityType: 'DEAL' as const,
        hubspotId: '58247306498',
        sapId: '49',
      };
      const createdRecord = { id: 'uuid-3', ...newMapping };
      mockIdMap.create.mockResolvedValueOnce(createdRecord);

      const result = await idmapRepo.create(newMapping);

      expect(mockIdMap.create).toHaveBeenCalledWith({ data: newMapping });
      expect(result.id).toBe('uuid-3');
    });
  });

  describe('acquireSyncLock()', () => {
    it('activa syncInProgress con el sistema iniciador', async () => {
      mockIdMap.update.mockResolvedValueOnce({
        id: 'uuid-1',
        syncInProgress: true,
        syncInitiatedBy: 'HUBSPOT',
        syncStartedAt: new Date(),
      });

      await idmapRepo.acquireSyncLock('uuid-1', 'HUBSPOT' as never);

      expect(mockIdMap.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          syncInProgress: true,
          syncInitiatedBy: 'HUBSPOT',
          syncStartedAt: expect.any(Date),
        },
      });
    });
  });

  describe('releaseSyncLock()', () => {
    it('desactiva syncInProgress y limpia campos', async () => {
      mockIdMap.update.mockResolvedValueOnce({
        id: 'uuid-1',
        syncInProgress: false,
        syncInitiatedBy: null,
        syncStartedAt: null,
      });

      await idmapRepo.releaseSyncLock('uuid-1');

      expect(mockIdMap.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          syncInProgress: false,
          syncInitiatedBy: null,
          syncStartedAt: null,
        },
      });
    });
  });

  describe('isSyncLocked()', () => {
    it('retorna locked=false si no existe el registro', async () => {
      mockIdMap.findUnique.mockResolvedValueOnce(null);

      const result = await idmapRepo.isSyncLocked('uuid-inexistente');

      expect(result).toEqual({ locked: false, initiatedBy: null });
    });

    it('retorna locked=false si syncInProgress es false', async () => {
      mockIdMap.findUnique.mockResolvedValueOnce({
        id: 'uuid-1',
        syncInProgress: false,
        syncStartedAt: null,
        syncInitiatedBy: null,
      });

      const result = await idmapRepo.isSyncLocked('uuid-1');

      expect(result).toEqual({ locked: false, initiatedBy: null });
    });

    it('retorna locked=true si sync está en progreso y dentro del timeout', async () => {
      mockIdMap.findUnique.mockResolvedValueOnce({
        id: 'uuid-1',
        syncInProgress: true,
        syncStartedAt: new Date(),
        syncInitiatedBy: 'HUBSPOT',
      });

      const result = await idmapRepo.isSyncLocked('uuid-1');

      expect(result).toEqual({ locked: true, initiatedBy: 'HUBSPOT' });
    });

    it('retorna locked=false si el lock expiró (>30s)', async () => {
      const expiredTime = new Date(Date.now() - 60_000);
      mockIdMap.findUnique.mockResolvedValueOnce({
        id: 'uuid-1',
        syncInProgress: true,
        syncStartedAt: expiredTime,
        syncInitiatedBy: 'SAP',
      });

      const result = await idmapRepo.isSyncLocked('uuid-1');

      expect(result).toEqual({ locked: false, initiatedBy: null });
    });
  });
});
