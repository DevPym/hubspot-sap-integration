/**
 * Tests para sap-poller.service.ts — Poller SAP → HubSpot.
 *
 * Verifica:
 * - Asociación Deal↔Company (SoldToParty → HubSpot association)
 * - Asociación Contact↔Company (NaturalPersonEmployerName → HubSpot association)
 * - Flujo normal de sync BP → HubSpot
 * - Flujo normal de sync SalesOrder → HubSpot
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    put: vi.fn(),
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

vi.mock('../src/services/mapper.service', () => ({
  sapBPToContactUpdate: vi.fn(() => ({ firstname: 'Juan', lastname: 'Pérez' })),
  sapBPToCompanyUpdate: vi.fn(() => ({ name: 'Empresa Test' })),
  salesOrderToDealUpdate: vi.fn(() => ({ dealname: 'Deal Test', amount: '100000' })),
}));

// Imports después de mocks
import { sapClient } from '../src/adapters/sap/sap.client';
import { hubspotClient } from '../src/adapters/hubspot/hubspot.client';
import * as idMapRepo from '../src/db/repositories/idmap.repository';
import { manualPoll } from '../src/services/sap-poller.service';

// Helpers para casting
const mockSapGet = sapClient.get as ReturnType<typeof vi.fn>;
const mockHsGet = hubspotClient.get as ReturnType<typeof vi.fn>;
const mockHsPatch = hubspotClient.patch as ReturnType<typeof vi.fn>;
const mockHsPut = hubspotClient.put as ReturnType<typeof vi.fn>;
const mockHsPost = hubspotClient.post as ReturnType<typeof vi.fn>;
const mockFindBySapId = idMapRepo.findBySapId as ReturnType<typeof vi.fn>;
const mockFindByHubSpotId = idMapRepo.findByHubSpotId as ReturnType<typeof vi.fn>;
const mockAcquireLock = idMapRepo.acquireSyncLock as ReturnType<typeof vi.fn>;
const mockReleaseLock = idMapRepo.releaseSyncLock as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquireLock.mockResolvedValue(undefined);
  mockReleaseLock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mapeo base para id_map */
const baseDealMapping = {
  id: 'map-deal-1',
  entityType: 'DEAL',
  hubspotId: '999001',
  sapId: '50',
  syncInProgress: false,
  syncInitiatedBy: null,
  syncStartedAt: null,
  updatedAt: new Date('2025-01-01'),
  createdAt: new Date('2025-01-01'),
};

const baseContactMapping = {
  id: 'map-contact-1',
  entityType: 'CONTACT',
  hubspotId: '888001',
  sapId: '100000031',
  syncInProgress: false,
  syncInitiatedBy: null,
  syncStartedAt: null,
  updatedAt: new Date('2025-01-01'),
  createdAt: new Date('2025-01-01'),
};

const baseCompanyMapping = {
  id: 'map-company-1',
  entityType: 'COMPANY',
  hubspotId: '777001',
  sapId: '100000030',
  syncInProgress: false,
  syncInitiatedBy: null,
  syncStartedAt: null,
  updatedAt: new Date('2025-01-01'),
  createdAt: new Date('2025-01-01'),
};

// ---------------------------------------------------------------------------
// Tests: Deal ↔ Company Association (SAP → HubSpot)
// ---------------------------------------------------------------------------

describe('sap-poller: Deal↔Company association sync', () => {
  it('crea asociación Deal↔Company en HubSpot cuando SoldToParty existe en id_map', async () => {
    // SAP devuelve SalesOrders con SoldToParty
    mockSapGet.mockImplementation((url: string) => {
      if (url.includes('A_BusinessPartner')) {
        return Promise.resolve({ data: { d: { results: [] } } }); // Sin BPs modificados
      }
      if (url.includes('A_SalesOrder')) {
        return Promise.resolve({
          data: {
            d: {
              results: [{
                SalesOrder: '50',
                SoldToParty: '100000030',
                SalesOrderType: 'OR',
                SalesOrganization: '4601',
                DistributionChannel: 'CF',
                OrganizationDivision: '10',
                LastChangeDateTime: `/Date(${Date.now()})/`,
              }],
            },
          },
        });
      }
      return Promise.resolve({ data: { d: { results: [] } } });
    });

    // Deal mapping existe
    mockFindBySapId.mockImplementation((type: string, sapId: string) => {
      if (type === 'DEAL' && sapId === '50') return Promise.resolve(baseDealMapping);
      if (type === 'COMPANY' && sapId === '100000030') return Promise.resolve(baseCompanyMapping);
      return Promise.resolve(null);
    });

    // PATCH HubSpot OK
    mockHsPatch.mockResolvedValue({ data: {} });

    // GET asociaciones actuales del Deal: vacío (sin asociación actual)
    mockHsGet.mockImplementation((url: string) => {
      if (url.includes('/associations/company')) {
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    // PUT asociación v4 OK
    mockHsPut.mockResolvedValue({ data: {} });

    await manualPoll();

    // Verificar que se llamó PUT para crear la asociación
    const putCalls = mockHsPut.mock.calls;
    const assocCall = putCalls.find((call: unknown[]) =>
      (call[0] as string).includes('/associations/companies/'),
    );

    expect(assocCall).toBeDefined();
    expect(assocCall![0]).toContain('/crm/v4/objects/deals/999001/associations/companies/777001');
    expect(assocCall![1]).toEqual([
      { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 },
    ]);
  });

  it('no crea asociación si Deal ya está vinculado a la Company correcta', async () => {
    mockSapGet.mockImplementation((url: string) => {
      if (url.includes('A_BusinessPartner')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('A_SalesOrder')) {
        return Promise.resolve({
          data: {
            d: {
              results: [{
                SalesOrder: '50',
                SoldToParty: '100000030',
                SalesOrderType: 'OR',
                LastChangeDateTime: `/Date(${Date.now()})/`,
              }],
            },
          },
        });
      }
      return Promise.resolve({ data: { d: { results: [] } } });
    });

    mockFindBySapId.mockImplementation((type: string, sapId: string) => {
      if (type === 'DEAL' && sapId === '50') return Promise.resolve(baseDealMapping);
      if (type === 'COMPANY' && sapId === '100000030') return Promise.resolve(baseCompanyMapping);
      return Promise.resolve(null);
    });

    mockHsPatch.mockResolvedValue({ data: {} });

    // Ya está asociada — la Company 777001 ya aparece en asociaciones
    mockHsGet.mockImplementation((url: string) => {
      if (url.includes('/associations/company')) {
        return Promise.resolve({
          data: { results: [{ id: '777001', type: 'deal_to_company' }] },
        });
      }
      return Promise.resolve({ data: {} });
    });

    await manualPoll();

    // No debería llamar a PUT (no crear asociación duplicada)
    const putCalls = mockHsPut.mock.calls;
    const assocCall = putCalls.find((call: unknown[]) =>
      (call[0] as string).includes('/associations/'),
    );
    expect(assocCall).toBeUndefined();
  });

  it('no crea asociación si SoldToParty no está en id_map', async () => {
    mockSapGet.mockImplementation((url: string) => {
      if (url.includes('A_BusinessPartner')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('A_SalesOrder')) {
        return Promise.resolve({
          data: {
            d: {
              results: [{
                SalesOrder: '50',
                SoldToParty: '999999', // No mapeado
                LastChangeDateTime: `/Date(${Date.now()})/`,
              }],
            },
          },
        });
      }
      return Promise.resolve({ data: { d: { results: [] } } });
    });

    mockFindBySapId.mockImplementation((type: string, sapId: string) => {
      if (type === 'DEAL' && sapId === '50') return Promise.resolve(baseDealMapping);
      // COMPANY 999999 no está en id_map
      return Promise.resolve(null);
    });

    mockHsPatch.mockResolvedValue({ data: {} });

    await manualPoll();

    // No debería llamar a PUT ni GET de asociaciones
    const putCalls = mockHsPut.mock.calls;
    expect(putCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Contact ↔ Company Association (SAP → HubSpot)
// ---------------------------------------------------------------------------

describe('sap-poller: Contact↔Company association sync', () => {
  it('crea asociación Contact↔Company cuando NaturalPersonEmployerName matchea una Company en HubSpot', async () => {
    // SAP devuelve un BP Persona con NaturalPersonEmployerName
    mockSapGet.mockImplementation((url: string) => {
      if (url.includes('A_SalesOrder')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('/to_BusinessPartnerAddress')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('A_BusinessPartner')) {
        return Promise.resolve({
          data: {
            d: {
              results: [{
                BusinessPartner: '100000031',
                BusinessPartnerCategory: '1',
                FirstName: 'Juan',
                LastName: 'Pérez',
                NaturalPersonEmployerName: 'Empresa Test',
                LastChangeDate: `/Date(${Date.now()})/`,
              }],
            },
          },
        });
      }
      return Promise.resolve({ data: { d: { results: [] } } });
    });

    // Contact mapping existe
    mockFindBySapId.mockImplementation((type: string, sapId: string) => {
      if (type === 'CONTACT' && sapId === '100000031') return Promise.resolve(baseContactMapping);
      return Promise.resolve(null);
    });

    // PATCH HubSpot OK
    mockHsPatch.mockResolvedValue({ data: {} });

    // Search API devuelve la Company
    mockHsPost.mockResolvedValue({
      data: {
        results: [{ id: '777001', properties: { name: 'Empresa Test' } }],
      },
    });

    // Company está en id_map
    mockFindByHubSpotId.mockImplementation((type: string, hsId: string) => {
      if (type === 'COMPANY' && hsId === '777001') return Promise.resolve(baseCompanyMapping);
      return Promise.resolve(null);
    });

    // GET asociaciones actuales del Contact: vacío
    mockHsGet.mockImplementation((url: string) => {
      if (url.includes('/associations/company')) {
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    // PUT asociación OK
    mockHsPut.mockResolvedValue({ data: {} });

    await manualPoll();

    // Verificar que se buscó la Company por nombre
    const postCalls = mockHsPost.mock.calls;
    const searchCall = postCalls.find((call: unknown[]) =>
      (call[0] as string).includes('/companies/search'),
    );
    expect(searchCall).toBeDefined();

    // Verificar que se creó la asociación Contact↔Company
    const putCalls = mockHsPut.mock.calls;
    const assocCall = putCalls.find((call: unknown[]) =>
      (call[0] as string).includes('/contacts/') && (call[0] as string).includes('/associations/'),
    );
    expect(assocCall).toBeDefined();
    expect(assocCall![0]).toContain('/crm/v4/objects/contacts/888001/associations/companies/777001');
    expect(assocCall![1]).toEqual([
      { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 },
    ]);
  });

  it('no crea asociación Contact↔Company si no hay NaturalPersonEmployerName', async () => {
    mockSapGet.mockImplementation((url: string) => {
      if (url.includes('A_SalesOrder')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('/to_BusinessPartnerAddress')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('A_BusinessPartner')) {
        return Promise.resolve({
          data: {
            d: {
              results: [{
                BusinessPartner: '100000031',
                BusinessPartnerCategory: '1',
                FirstName: 'Juan',
                LastName: 'Pérez',
                // Sin NaturalPersonEmployerName
                LastChangeDate: `/Date(${Date.now()})/`,
              }],
            },
          },
        });
      }
      return Promise.resolve({ data: { d: { results: [] } } });
    });

    mockFindBySapId.mockImplementation((type: string, sapId: string) => {
      if (type === 'CONTACT' && sapId === '100000031') return Promise.resolve(baseContactMapping);
      return Promise.resolve(null);
    });

    mockHsPatch.mockResolvedValue({ data: {} });

    await manualPoll();

    // No debería buscar Companies ni crear asociación
    expect(mockHsPost).not.toHaveBeenCalled();
    expect(mockHsPut).not.toHaveBeenCalled();
  });

  it('no crea asociación si la Company encontrada no está en id_map', async () => {
    mockSapGet.mockImplementation((url: string) => {
      if (url.includes('A_SalesOrder')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('/to_BusinessPartnerAddress')) {
        return Promise.resolve({ data: { d: { results: [] } } });
      }
      if (url.includes('A_BusinessPartner')) {
        return Promise.resolve({
          data: {
            d: {
              results: [{
                BusinessPartner: '100000031',
                BusinessPartnerCategory: '1',
                NaturalPersonEmployerName: 'Empresa No Sincronizada',
                LastChangeDate: `/Date(${Date.now()})/`,
              }],
            },
          },
        });
      }
      return Promise.resolve({ data: { d: { results: [] } } });
    });

    mockFindBySapId.mockImplementation((type: string, sapId: string) => {
      if (type === 'CONTACT' && sapId === '100000031') return Promise.resolve(baseContactMapping);
      return Promise.resolve(null);
    });

    mockHsPatch.mockResolvedValue({ data: {} });

    // Search devuelve Company pero NO está en id_map
    mockHsPost.mockResolvedValue({
      data: {
        results: [{ id: '555555', properties: { name: 'Empresa No Sincronizada' } }],
      },
    });

    mockFindByHubSpotId.mockResolvedValue(null); // No está en id_map

    await manualPoll();

    // No debería crear asociación (Company no sincronizada)
    expect(mockHsPut).not.toHaveBeenCalled();
  });
});
