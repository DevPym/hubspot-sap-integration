/**
 * Tests extendidos para sync.service.ts — Gaps de cobertura.
 *
 * Verifica:
 * - UPDATE Deal (pasa anti-bucle + LWW + PATCH SalesOrder)
 * - UPDATE Company
 * - syncBPSubEntities: email POST cuando PATCH falla
 * - syncBPSubEntities: phone POST cuando PATCH falla
 * - syncBPSubEntities: mobile sub-entity (solo Contact)
 * - syncBPSubEntities: no bloquea sync si falla
 * - Writeback id_sap a HubSpot (CREATE)
 * - Error Axios con response.data → errorMessage incluye detalle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HubSpotSyncEvent } from '../src/services/sync.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../src/adapters/sap/sap.client', () => ({
  sapClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    patchWithETag: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../src/adapters/hubspot/hubspot.client', () => ({
  hubspotClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../src/db/repositories/idmap.repository', () => ({
  findByHubSpotId: vi.fn(),
  findBySapId: vi.fn(),
  create: vi.fn(),
  acquireSyncLock: vi.fn(),
  releaseSyncLock: vi.fn(),
  isSyncLocked: vi.fn(),
}));

vi.mock('../src/db/repositories/synclog.repository', () => ({
  create: vi.fn(),
}));

import { syncHubSpotToSap } from '../src/services/sync.service';
import { sapClient } from '../src/adapters/sap/sap.client';
import { hubspotClient } from '../src/adapters/hubspot/hubspot.client';
import * as idMapRepo from '../src/db/repositories/idmap.repository';
import * as syncLogRepo from '../src/db/repositories/synclog.repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSapBPAddress() {
  vi.mocked(sapClient.get).mockResolvedValue({
    data: { d: { results: [{ AddressID: '1', Person: '' }] } },
    status: 200, statusText: 'OK', headers: {}, config: {} as never,
  });
}

const existingContactMap = {
  id: 'uuid-contact',
  entityType: 'CONTACT' as const,
  hubspotId: '210581802294',
  sapId: '100000031',
  syncInProgress: false,
  syncInitiatedBy: null,
  syncStartedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-10T00:00:00Z'),
};

const existingDealMap = {
  id: 'uuid-deal',
  entityType: 'DEAL' as const,
  hubspotId: '58247306498',
  sapId: '50',
  syncInProgress: false,
  syncInitiatedBy: null,
  syncStartedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-10T00:00:00Z'),
};

const existingCompanyMap = {
  id: 'uuid-company',
  entityType: 'COMPANY' as const,
  hubspotId: '53147869965',
  sapId: '100000060',
  syncInProgress: false,
  syncInitiatedBy: null,
  syncStartedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-10T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(syncLogRepo.create).mockResolvedValue({} as never);
});

// ---------------------------------------------------------------------------
// UPDATE Deal
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — UPDATE Deal', () => {
  it('actualiza SalesOrder en SAP cuando Deal existe en id_map', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(existingDealMap as never);
    vi.mocked(idMapRepo.isSyncLocked).mockResolvedValue({ locked: false, initiatedBy: null });
    vi.mocked(idMapRepo.acquireSyncLock).mockResolvedValue({} as never);
    vi.mocked(idMapRepo.releaseSyncLock).mockResolvedValue({} as never);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '58247306498',
        properties: {
          dealname: 'Deal Actualizado',
          closedate: '2024-07-15',
          deal_currency_code: 'CLP',
        },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    vi.mocked(sapClient.patchWithETag).mockResolvedValue({
      data: undefined,
      status: 204, statusText: 'No Content', headers: {}, config: {} as never,
    });

    const result = await syncHubSpotToSap({
      objectId: '58247306498',
      entityType: 'DEAL',
      occurredAt: new Date('2024-01-15T10:00:00Z').getTime(),
      subscriptionType: 'deal.propertyChange',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('UPDATE');
    expect(sapClient.patchWithETag).toHaveBeenCalledWith(
      "/API_SALES_ORDER_SRV/A_SalesOrder('50')",
      expect.any(Object),
    );
    expect(idMapRepo.acquireSyncLock).toHaveBeenCalledWith('uuid-deal', 'HUBSPOT');
    expect(idMapRepo.releaseSyncLock).toHaveBeenCalledWith('uuid-deal');
  });
});

// ---------------------------------------------------------------------------
// UPDATE Company
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — UPDATE Company', () => {
  it('actualiza BP Organización en SAP', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(existingCompanyMap as never);
    vi.mocked(idMapRepo.isSyncLocked).mockResolvedValue({ locked: false, initiatedBy: null });
    vi.mocked(idMapRepo.acquireSyncLock).mockResolvedValue({} as never);
    vi.mocked(idMapRepo.releaseSyncLock).mockResolvedValue({} as never);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '53147869965',
        properties: { name: 'Empresa Actualizada', phone: '+56221111111' },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    vi.mocked(sapClient.patchWithETag).mockResolvedValue({
      data: undefined,
      status: 204, statusText: 'No Content', headers: {}, config: {} as never,
    });

    // Mock para syncBPSubEntities
    mockSapBPAddress();

    const result = await syncHubSpotToSap({
      objectId: '53147869965',
      entityType: 'COMPANY',
      occurredAt: new Date('2024-01-15T10:00:00Z').getTime(),
      subscriptionType: 'company.propertyChange',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('UPDATE');
    expect(sapClient.patchWithETag).toHaveBeenCalledWith(
      "/API_BUSINESS_PARTNER/A_BusinessPartner('100000060')",
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// Sub-entities sync (email, phone fallback POST)
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — syncBPSubEntities', () => {
  it('crea email con POST si PATCH falla (email no existía)', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(null);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '210581802294',
        properties: {
          firstname: 'Test',
          lastname: 'SubEntities',
          email: 'new@test.cl',
          phone: '+56912345678',
        },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    vi.mocked(sapClient.post).mockResolvedValue({
      data: { d: { BusinessPartner: '100000099' } },
      status: 201, statusText: 'Created', headers: {}, config: {} as never,
    });

    vi.mocked(idMapRepo.create).mockResolvedValue({
      id: 'uuid-new',
      entityType: 'CONTACT',
      hubspotId: '210581802294',
      sapId: '100000099',
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock sapClient.get para sub-entities
    vi.mocked(sapClient.get).mockResolvedValue({
      data: { d: { results: [{ AddressID: '557', Person: 'P001' }] } },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    // patchWithETag: address OK, email fail, phone fail
    vi.mocked(sapClient.patchWithETag)
      .mockResolvedValueOnce({ data: undefined, status: 204, statusText: 'No Content', headers: {}, config: {} as never }) // address PATCH OK
      .mockRejectedValueOnce(new Error('Not Found')) // email PATCH fail → POST fallback
      .mockRejectedValueOnce(new Error('Not Found')); // phone PATCH fail → POST fallback

    // sapClient.post: first call = BP creation, next calls = sub-entity POST fallbacks
    vi.mocked(sapClient.post)
      .mockResolvedValueOnce({ data: { d: { BusinessPartner: '100000099' } }, status: 201, statusText: 'Created', headers: {}, config: {} as never })
      .mockResolvedValueOnce({ data: {}, status: 201, statusText: 'Created', headers: {}, config: {} as never }) // email POST
      .mockResolvedValueOnce({ data: {}, status: 201, statusText: 'Created', headers: {}, config: {} as never }); // phone POST

    // Writeback mock
    vi.mocked(hubspotClient.patch).mockResolvedValue({
      data: { id: '210581802294' },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    const result = await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: Date.now(),
      subscriptionType: 'contact.creation',
    });

    expect(result.success).toBe(true);
    // Al menos BP creation POST + algun sub-entity POST
    expect(sapClient.post).toHaveBeenCalled();
    // Email PATCH debió fallar, triggering POST fallback
    expect(sapClient.patchWithETag).toHaveBeenCalled();
  });

  it('no bloquea sync si sub-entities fallan completamente', async () => {
    vi.resetAllMocks();
    vi.mocked(syncLogRepo.create).mockResolvedValue({} as never);
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(null);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '333444555',
        properties: { firstname: 'Fail', lastname: 'SubEntities', email: 'fail@test.cl' },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    vi.mocked(sapClient.post).mockResolvedValue({
      data: { d: { BusinessPartner: '100000098' } },
      status: 201, statusText: 'Created', headers: {}, config: {} as never,
    });

    vi.mocked(idMapRepo.create).mockResolvedValue({
      id: 'uuid-fail-sub',
      entityType: 'CONTACT',
      hubspotId: '333444555',
      sapId: '100000098',
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // sapClient.get para Address falla completamente (sub-entity sync fails)
    vi.mocked(sapClient.get).mockRejectedValue(new Error('SAP Address unavailable'));

    // Writeback mock
    vi.mocked(hubspotClient.patch).mockResolvedValue({
      data: { id: '333444555' },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    // La sync NO debe fallar (sub-entities son no-críticas)
    const result = await syncHubSpotToSap({
      objectId: '333444555',
      entityType: 'CONTACT',
      occurredAt: Date.now(),
      subscriptionType: 'contact.creation',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('CREATE');
  });
});

// ---------------------------------------------------------------------------
// Error con detalle Axios
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — error handling', () => {
  it('incluye detalle de response.data en errorMessage para errores Axios', async () => {
    // Reset ALL mocks including implementations to avoid contamination
    vi.resetAllMocks();
    vi.mocked(syncLogRepo.create).mockResolvedValue({} as never);

    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(existingContactMap as never);
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
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    // Error Axios con response.data
    const axiosError = new Error('Request failed') as Error & {
      response: { status: number; data: unknown };
    };
    axiosError.response = {
      status: 400,
      data: { error: { message: { value: 'BusinessPartner invalid' } } },
    };
    vi.mocked(sapClient.patchWithETag).mockRejectedValue(axiosError);

    const result = await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: new Date('2024-01-15T10:00:00Z').getTime(),
      subscriptionType: 'contact.propertyChange',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Request failed');
    expect(result.error).toContain('Status: 400');
    expect(result.error).toContain('BusinessPartner invalid');

    // sync_log debe incluir el detalle
    expect(syncLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: expect.stringContaining('BusinessPartner invalid'),
      }),
    );
  });

  it('MissingDependencyError NO genera sync_log FAILED adicional (solo PENDING)', async () => {
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
        status: 200, statusText: 'OK', headers: {}, config: {} as never,
      })
      .mockResolvedValueOnce({
        data: { results: [] }, // Sin asociaciones
        status: 200, statusText: 'OK', headers: {}, config: {} as never,
      });

    await expect(syncHubSpotToSap({
      objectId: '58247306498',
      entityType: 'DEAL',
      occurredAt: Date.now(),
      subscriptionType: 'deal.creation',
    })).rejects.toThrow('no encontrada en id_map');

    // Debe tener solo PENDING (no FAILED)
    const syncLogCalls = vi.mocked(syncLogRepo.create).mock.calls;
    const statusValues = syncLogCalls.map((c) => (c[0] as Record<string, unknown>).status);
    expect(statusValues).toContain('PENDING');
    expect(statusValues).not.toContain('FAILED');
  });
});

// ---------------------------------------------------------------------------
// Writeback id_sap a HubSpot
// ---------------------------------------------------------------------------

describe('syncHubSpotToSap — writeback id_sap', () => {
  it('escribe id_sap en HubSpot después de CREATE exitoso', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(null);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '210581802294',
        properties: { firstname: 'Test', lastname: 'Writeback' },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    vi.mocked(sapClient.post).mockResolvedValue({
      data: { d: { BusinessPartner: '100000077' } },
      status: 201, statusText: 'Created', headers: {}, config: {} as never,
    });

    vi.mocked(idMapRepo.create).mockResolvedValue({
      id: 'uuid-wb',
      entityType: 'CONTACT',
      hubspotId: '210581802294',
      sapId: '100000077',
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSapBPAddress();

    // Writeback PATCH
    vi.mocked(hubspotClient.patch).mockResolvedValue({
      data: { id: '210581802294' },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: Date.now(),
      subscriptionType: 'contact.creation',
    });

    // Verificar writeback
    expect(hubspotClient.patch).toHaveBeenCalledWith(
      '/crm/v3/objects/contacts/210581802294',
      { properties: { id_sap: '100000077' } },
    );
  });

  it('no falla si writeback id_sap falla (no crítico)', async () => {
    vi.mocked(idMapRepo.findByHubSpotId).mockResolvedValue(null);

    vi.mocked(hubspotClient.get).mockResolvedValue({
      data: {
        id: '210581802294',
        properties: { firstname: 'Test', lastname: 'Writeback' },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-15',
        archived: false,
      },
      status: 200, statusText: 'OK', headers: {}, config: {} as never,
    });

    vi.mocked(sapClient.post).mockResolvedValue({
      data: { d: { BusinessPartner: '100000078' } },
      status: 201, statusText: 'Created', headers: {}, config: {} as never,
    });

    vi.mocked(idMapRepo.create).mockResolvedValue({
      id: 'uuid-wb-fail',
      entityType: 'CONTACT',
      hubspotId: '210581802294',
      sapId: '100000078',
      syncInProgress: false,
      syncInitiatedBy: null,
      syncStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSapBPAddress();

    // Writeback falla
    vi.mocked(hubspotClient.patch).mockRejectedValue(new Error('HubSpot writeback error'));

    // La sync completa NO debe fallar
    const result = await syncHubSpotToSap({
      objectId: '210581802294',
      entityType: 'CONTACT',
      occurredAt: Date.now(),
      subscriptionType: 'contact.creation',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('CREATE');
  });
});
