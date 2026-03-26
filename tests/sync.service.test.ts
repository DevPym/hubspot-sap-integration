/**
 * Tests para sync.service.ts — Orquestador de sincronización.
 *
 * Usa mocks de:
 * - sap.client.ts (no llama a SAP real)
 * - hubspot.client.ts (no llama a HubSpot real)
 * - idmap.repository.ts (no toca la DB)
 * - synclog.repository.ts (no toca la DB)
 *
 * Verifica los flujos de:
 * - CREATE: Contact, Company, Deal (incluyendo resolución de Company asociada)
 * - UPDATE: con anti-bucle y LWW
 * - SKIP: por anti-bucle o LWW
 * - ERROR: Company no sincronizada para Deal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HubSpotSyncEvent } from '../src/services/sync.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock de sap.client
vi.mock('../src/adapters/sap/sap.client', () => ({
  sapClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    patchWithETag: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock de hubspot.client
vi.mock('../src/adapters/hubspot/hubspot.client', () => ({
  hubspotClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock de idmap.repository
vi.mock('../src/db/repositories/idmap.repository', () => ({
  findByHubSpotId: vi.fn(),
  findBySapId: vi.fn(),
  create: vi.fn(),
  acquireSyncLock: vi.fn(),
  releaseSyncLock: vi.fn(),
  isSyncLocked: vi.fn(),
}));

// Mock de synclog.repository
vi.mock('../src/db/repositories/synclog.repository', () => ({
  create: vi.fn(),
}));

// Imports después de los mocks
import { syncHubSpotToSap } from '../src/services/sync.service';
import { sapClient } from '../src/adapters/sap/sap.client';
import { hubspotClient } from '../src/adapters/hubspot/hubspot.client';
import * as idMapRepo from '../src/db/repositories/idmap.repository';
import * as syncLogRepo from '../src/db/repositories/synclog.repository';

// ---------------------------------------------------------------------------
// Helper: mock de sapClient.get para to_BusinessPartnerAddress
// Usado en syncBPSubEntities — se llama después de crear/actualizar un BP.
// ---------------------------------------------------------------------------

function mockSapBPAddress() {
  vi.mocked(sapClient.get).mockResolvedValue({
    data: { d: { results: [{ AddressID: '1', Person: '' }] } },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: synclog.create no falla
  vi.mocked(syncLogRepo.create).mockResolvedValue({} as never);
});

// ---------------------------------------------------------------------------
// CREATE Contact
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — CREATE Contact', () => {
  it('crea BP Persona en SAP cuando Contact no existe en id_map', async () => {
    // No existe mapping
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(null);

    // HubSpot devuelve Contact
    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '210581802294',
        properties: {
          firstname: 'Max',
          lastname: 'Power',
          email: 'max@test.cl',
          phone: '+56912345678',
        },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
    });

    // SAP devuelve BP creado
    vi.mocked(sapClient.post).mockResolvedValue({
      data: { d: { BusinessPartner: '100000050' } },
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {} as never,
    });

    // idMap create retorna mapping
    vi.mocked(idMapRepo.create).mockResolvedValue({
      id: 'uuid-1',
      entityType: 'CONTACT',
      hubspotId: '210581802294',
      sapId: '100000050',
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock sapClient.get para syncBPSubEntities → to_BusinessPartnerAddress
    mockSapBPAddress();

    const event: HubSpotSyncEvent = {
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: Date.now(),
      subscriptionType: 'contact.creation',
    };

    const result = await syncHubSpotToSap(event);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('CREATE');
    expect(result.sapId).toBe('100000050');
    expect(sapClient.post).toHaveBeenCalledTimes(1);
    expect(idMapRepo.create).toHaveBeenCalledWith({
      entityType: 'CONTACT',
      hubspotId: '210581802294',
      sapId: '100000050',
    });
  });
});

// ---------------------------------------------------------------------------
// CREATE Company
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — CREATE Company', () => {
  it('crea BP Organización en SAP', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(null);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '53147869965',
        properties: {
          name: 'Empresa Test',
          rut: '12.345.678-9',
          phone: '+56221234567',
        },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
    });

    vi.mocked(sapClient.post).mockResolvedValue({
      data: { d: { BusinessPartner: '100000060' } },
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {} as never,
    });

    vi.mocked(idMapRepo.create).mockResolvedValue({
      id: 'uuid-2',
      entityType: 'COMPANY',
      hubspotId: '53147869965',
      sapId: '100000060',
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock sapClient.get para syncBPSubEntities → to_BusinessPartnerAddress
    mockSapBPAddress();

    const result = await syncHubSpotToSap({
      objectId: '53147869965',
      entityType: 'COMPANY',
      occurredAt: Date.now(),
      subscriptionType: 'company.creation',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('CREATE');
    expect(result.sapId).toBe('100000060');
  });
});

// ---------------------------------------------------------------------------
// CREATE Deal (con Company asociada)
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — CREATE Deal', () => {
  it('crea Sales Order en SAP resolviendo Company asociada', async () => {
    vi.mocked(idMapRepo.findByHubSpotId)
      // Primera llamada: Deal no existe en id_map
      .mockResolvedValueOnce(null)
      // Segunda llamada: Company existe en id_map (resolveCompanyForDeal)
      .mockResolvedValueOnce({
        id: 'uuid-company',
        entityType: 'COMPANY',
        hubspotId: '53147869965',
        sapId: '100000030',
        syncInProgress: false,
        syncInitiatedBy: null,
        syncStartedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

    // HubSpot devuelve Deal
    vi.mocked(hubspotClient.get)
      .mockResolvedValueOnce({
        data: {
          id: '58247306498',
          properties: {
            dealname: 'Deal Test SAP',
            closedate: '2024-06-30',
            deal_currency_code: 'CLP',
            cantidad_producto: '100',
          },
          createdAt: '2024-01-01',
          updatedAt: '2024-01-15',
          archived: false,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
      // Asociaciones: Deal → Company
      .mockResolvedValueOnce({
        data: {
          results: [{ id: '53147869965', type: 'deal_to_company' }],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      });

    vi.mocked(sapClient.post).mockResolvedValue({
      data: { d: { SalesOrder: '50' } },
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {} as never,
    });

    vi.mocked(idMapRepo.create).mockResolvedValue({
      id: 'uuid-3',
      entityType: 'DEAL',
      hubspotId: '58247306498',
      sapId: '50',
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Deal no llama syncBPSubEntities — no necesita mockSapBPAddress()

    const result = await syncHubSpotToSap({
      objectId: '58247306498',
      entityType: 'DEAL',
      occurredAt: Date.now(),
      subscriptionType: 'deal.creation',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('CREATE');
    expect(result.sapId).toBe('50');
  });

  it('falla si Company asociada no está en id_map', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(null);

    vi.mocked(hubspotClient.get)
      .mockResolvedValueOnce({
        data: {
          id: '58247306498',
          properties: { dealname: 'Deal Sin Company' },
          createdAt: '2024-01-01',
          updatedAt: '2024-01-15',
          archived: false,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      })
      // Asociaciones vacías
      .mockResolvedValueOnce({
        data: { results: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as never,
      });

    const result = await syncHubSpotToSap({
      objectId: '58247306498',
      entityType: 'DEAL',
      occurredAt: Date.now(),
      subscriptionType: 'deal.creation',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Company');
  });
});

// ---------------------------------------------------------------------------
// UPDATE — con anti-bucle y LWW
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — UPDATE', () => {
  const existingMap = {
    id: 'uuid-existing',
    entityType: 'CONTACT' as const,
    hubspotId: '210581802294',
    sapId: '100000031',
    syncInProgress: false,
    syncInitiatedBy: null,
    syncStartedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-10T00:00:00Z'),
  };

  it('actualiza BP en SAP si pasa anti-bucle y LWW', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(existingMap as never);
    vi.mocked(idMapRepo.isSyncLocked).mockResolvedValue({ locked: false, initiatedBy: null });
    vi.mocked(idMapRepo.acquireSyncLock).mockResolvedValue({} as never);
    vi.mocked(idMapRepo.releaseSyncLock).mockResolvedValue({} as never);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '210581802294',
        properties: { firstname: 'Carlos', lastname: 'Power' },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
    });

    vi.mocked(sapClient.patchWithETag).mockResolvedValue({
      data: undefined,
      status: 204,
      statusText: 'No Content',
      headers: {},
      config: {} as never,
    });

    // Mock sapClient.get para syncBPSubEntities → to_BusinessPartnerAddress
    mockSapBPAddress();

    const result = await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: new Date('2024-01-15T10:00:00Z').getTime(), // > updatedAt
      subscriptionType: 'contact.propertyChange',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('UPDATE');
    expect(sapClient.patchWithETag).toHaveBeenCalledTimes(1);
    expect(idMapRepo.acquireSyncLock).toHaveBeenCalledWith('uuid-existing', 'HUBSPOT');
    expect(idMapRepo.releaseSyncLock).toHaveBeenCalledWith('uuid-existing');
  });

  it('SKIP por anti-bucle (eco de nuestra sync)', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(existingMap as never);
    vi.mocked(idMapRepo.isSyncLocked).mockResolvedValue({
      locked: true,
      initiatedBy: 'SAP', // Lock iniciado por SAP, evento viene de HUBSPOT
    });

    const result = await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: Date.now(),
      subscriptionType: 'contact.propertyChange',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('SKIPPED');
    expect(result.reason).toContain('Anti-bucle');
    expect(sapClient.patchWithETag).not.toHaveBeenCalled();
  });

  it('SKIP por LWW (evento más viejo que última sync)', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(existingMap as never);
    vi.mocked(idMapRepo.isSyncLocked).mockResolvedValue({ locked: false, initiatedBy: null });

    const result = await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: new Date('2024-01-05T00:00:00Z').getTime(), // < updatedAt (2024-01-10)
      subscriptionType: 'contact.propertyChange',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('SKIPPED');
    expect(sapClient.patchWithETag).not.toHaveBeenCalled();
  });

  it('libera lock incluso si PATCH falla', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(existingMap as never);
    vi.mocked(idMapRepo.isSyncLocked).mockResolvedValue({ locked: false, initiatedBy: null });
    vi.mocked(idMapRepo.acquireSyncLock).mockResolvedValue({} as never);
    vi.mocked(idMapRepo.releaseSyncLock).mockResolvedValue({} as never);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '210581802294',
        properties: { firstname: 'Error' },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
    });

    // SAP falla — no se llega a syncBPSubEntities, no necesita mockSapBPAddress()
    vi.mocked(sapClient.patchWithETag).mockRejectedValue(new Error('SAP timeout'));

    const result = await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: new Date('2024-01-15T10:00:00Z').getTime(),
      subscriptionType: 'contact.propertyChange',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('SAP timeout');
    // Lock SIEMPRE se libera (finally)
    expect(idMapRepo.releaseSyncLock).toHaveBeenCalledWith('uuid-existing');
  });
});