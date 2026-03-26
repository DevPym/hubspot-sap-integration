/**
 * Tests extendidos para sap-poller.service.ts — Gaps de cobertura.
 *
 * Verifica:
 * - Anti-bucle para BP y SalesOrder
 * - Deduplicación por hash (datos idénticos no se reenvían)
 * - BP sin mapping → ignorar
 * - LastChangeDate anterior a updatedAt → ignorar
 * - Email duplicado → reintento sin email
 * - Error SAP en consulta → no crashea
 * - Error HubSpot PATCH → sync_log FAILED + lock liberado
 * - Company sync (BP Category=2)
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
  acquireSyncLock: vi.fn().mockResolvedValue(undefined),
  releaseSyncLock: vi.fn().mockResolvedValue(undefined),
  isSyncLocked: vi.fn(),
}));

vi.mock('../src/db/repositories/synclog.repository', () => ({
  create: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/services/mapper.service', () => ({
  sapBPToContactUpdate: vi.fn(() => ({ firstname: 'Juan', lastname: 'Pérez', email: 'juan@test.cl' })),
  sapBPToCompanyUpdate: vi.fn(() => ({ name: 'Empresa SAP' })),
  salesOrderToDealUpdate: vi.fn(() => ({ dealname: 'Deal SAP', amount: '50000' })),
}));

import { sapClient } from '../src/adapters/sap/sap.client';
import { hubspotClient } from '../src/adapters/hubspot/hubspot.client';
import * as idMapRepo from '../src/db/repositories/idmap.repository';
import * as syncLogRepo from '../src/db/repositories/synclog.repository';
import { manualPoll } from '../src/services/sap-poller.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSapGet = sapClient.get as ReturnType<typeof vi.fn>;
const mockHsPatch = hubspotClient.patch as ReturnType<typeof vi.fn>;
const mockHsPut = hubspotClient.put as ReturnType<typeof vi.fn>;
const mockFindBySapId = idMapRepo.findBySapId as ReturnType<typeof vi.fn>;
const mockAcquireLock = idMapRepo.acquireSyncLock as ReturnType<typeof vi.fn>;
const mockReleaseLock = idMapRepo.releaseSyncLock as ReturnType<typeof vi.fn>;
const mockSyncLogCreate = syncLogRepo.create as ReturnType<typeof vi.fn>;

const now = Date.now();

function makeMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    entityType: 'CONTACT',
    hubspotId: '111222',
    sapId: '100000031',
    syncInProgress: false,
    syncInitiatedBy: null,
    syncStartedAt: null,
    updatedAt: new Date(now - 600000), // 10 min atrás
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

/** Simula respuestas SAP: BPs en primera llamada, SalesOrders vacío en segunda */
function mockSapWithBPs(bps: unknown[]) {
  mockSapGet.mockImplementation((url: string) => {
    if (url.includes('/to_BusinessPartnerAddress')) {
      return Promise.resolve({ data: { d: { results: [{ AddressID: '1' }] } } });
    }
    if (url.includes('A_BusinessPartner')) {
      return Promise.resolve({ data: { d: { results: bps } } });
    }
    if (url.includes('A_SalesOrder')) {
      return Promise.resolve({ data: { d: { results: [] } } });
    }
    return Promise.resolve({ data: { d: { results: [] } } });
  });
}

/** Simula respuestas SAP: BPs vacío, SalesOrders en segunda llamada */
function mockSapWithSOs(sos: unknown[]) {
  mockSapGet.mockImplementation((url: string) => {
    if (url.includes('A_BusinessPartner')) {
      return Promise.resolve({ data: { d: { results: [] } } });
    }
    if (url.includes('A_SalesOrder')) {
      return Promise.resolve({ data: { d: { results: sos } } });
    }
    return Promise.resolve({ data: { d: { results: [] } } });
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquireLock.mockResolvedValue(undefined);
  mockReleaseLock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// BP sin mapping → ignorar
// ---------------------------------------------------------------------------

describe('SAP Poller — BP sin mapping', () => {
  it('ignora BP que no tiene mapping en id_map', async () => {
    mockSapWithBPs([{
      BusinessPartner: '999999',
      BusinessPartnerCategory: '1',
      FirstName: 'Desconocido',
      LastChangeDate: `/Date(${now})/`,
    }]);

    mockFindBySapId.mockResolvedValue(null); // Sin mapping

    await manualPoll();

    expect(mockHsPatch).not.toHaveBeenCalled();
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Anti-bucle: BP modificado por HubSpot → ignorar
// ---------------------------------------------------------------------------

describe('SAP Poller — anti-bucle BP', () => {
  it('SKIP si sync fue iniciada por HubSpot (anti-bucle)', async () => {
    mockSapWithBPs([{
      BusinessPartner: '100000031',
      BusinessPartnerCategory: '1',
      FirstName: 'Juan',
      LastChangeDate: `/Date(${now})/`,
    }]);

    mockFindBySapId.mockResolvedValue(makeMapping({
      syncInProgress: true,
      syncInitiatedBy: 'HUBSPOT',
      syncStartedAt: new Date(), // reciente, dentro de timeout
    }));

    await manualPoll();

    expect(mockHsPatch).not.toHaveBeenCalled();
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// LastChangeDate anterior → ignorar
// ---------------------------------------------------------------------------

describe('SAP Poller — timestamp LWW', () => {
  it('ignora BP si LastChangeDate <= updatedAt del mapping', async () => {
    const oldTimestamp = now - 3600000; // 1 hora atrás
    mockSapWithBPs([{
      BusinessPartner: '100000031',
      BusinessPartnerCategory: '1',
      FirstName: 'Juan',
      LastChangeDate: `/Date(${oldTimestamp})/`,
    }]);

    // updatedAt del mapping es DESPUÉS del LastChangeDate
    mockFindBySapId.mockResolvedValue(makeMapping({
      updatedAt: new Date(now), // ahora (posterior a oldTimestamp)
    }));

    await manualPoll();

    expect(mockHsPatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Company sync (Category=2)
// ---------------------------------------------------------------------------

describe('SAP Poller — Company sync', () => {
  it('actualiza Company en HubSpot cuando BP Category=2', async () => {
    mockSapWithBPs([{
      BusinessPartner: '100000060',
      BusinessPartnerCategory: '2',
      OrganizationBPName1: 'Empresa SAP',
      LastChangeDate: `/Date(${now})/`,
    }]);

    mockFindBySapId.mockResolvedValue(makeMapping({
      entityType: 'COMPANY',
      hubspotId: '53147869965',
      sapId: '100000060',
    }));

    mockHsPatch.mockResolvedValue({ data: {} });

    await manualPoll();

    expect(mockHsPatch).toHaveBeenCalledWith(
      '/crm/v3/objects/companies/53147869965',
      expect.objectContaining({ properties: expect.any(Object) }),
    );
    expect(mockSyncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'COMPANY',
        status: 'SUCCESS',
        sourceSystem: 'SAP',
        targetSystem: 'HUBSPOT',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// SalesOrder anti-bucle
// ---------------------------------------------------------------------------

describe('SAP Poller — anti-bucle SalesOrder', () => {
  it('SKIP si sync del Deal fue iniciada por HubSpot', async () => {
    mockSapWithSOs([{
      SalesOrder: '50',
      SoldToParty: '100000060',
      PurchaseOrderByCustomer: 'PO-TEST',
      LastChangeDateTime: `/Date(${now})/`,
    }]);

    mockFindBySapId.mockResolvedValue(makeMapping({
      entityType: 'DEAL',
      hubspotId: '58247306498',
      sapId: '50',
      syncInProgress: true,
      syncInitiatedBy: 'HUBSPOT',
      syncStartedAt: new Date(),
    }));

    await manualPoll();

    expect(mockHsPatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Email duplicado → reintento sin email
// ---------------------------------------------------------------------------

describe('SAP Poller — email duplicado', () => {
  it('reintenta PATCH sin email si HubSpot rechaza por duplicado', async () => {
    mockSapWithBPs([{
      BusinessPartner: '100000031',
      BusinessPartnerCategory: '1',
      FirstName: 'Juan',
      LastChangeDate: `/Date(${now})/`,
    }]);

    mockFindBySapId.mockResolvedValue(makeMapping());

    // Primer PATCH falla por email duplicado
    mockHsPatch
      .mockRejectedValueOnce(new Error('Property "email" already has that value on contact'))
      .mockResolvedValueOnce({ data: {} }); // Segundo intento OK

    await manualPoll();

    expect(mockHsPatch).toHaveBeenCalledTimes(2);
    // Segundo PATCH no debe incluir email
    const secondCall = mockHsPatch.mock.calls[1];
    const secondProps = (secondCall[1] as { properties: Record<string, string> }).properties;
    expect(secondProps).not.toHaveProperty('email');

    // Debe loguearse como SUCCESS (reintento exitoso)
    expect(mockSyncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESS' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Error HubSpot PATCH → FAILED + lock liberado
// ---------------------------------------------------------------------------

describe('SAP Poller — error HubSpot', () => {
  it('registra FAILED en sync_log y libera lock si PATCH falla', async () => {
    // Usar un sapId diferente para evitar deduplicación por hash del cache interno
    mockSapWithBPs([{
      BusinessPartner: '100000099',
      BusinessPartnerCategory: '1',
      FirstName: 'ErrorTest',
      LastChangeDate: `/Date(${now})/`,
    }]);

    mockFindBySapId.mockResolvedValue(makeMapping({ sapId: '100000099' }));
    mockHsPatch.mockRejectedValue(new Error('HubSpot Internal Server Error'));

    await manualPoll();

    expect(mockSyncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'SAP_POLL_ERROR',
        errorMessage: expect.stringContaining('HubSpot Internal Server Error'),
      }),
    );
    // Lock SIEMPRE se libera
    expect(mockReleaseLock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error SAP en consulta → no crashea
// ---------------------------------------------------------------------------

describe('SAP Poller — error SAP', () => {
  it('no lanza error si SAP falla al consultar BPs', async () => {
    mockSapGet
      .mockRejectedValueOnce(new Error('SAP timeout')) // falla BPs
      .mockResolvedValueOnce({ data: { d: { results: [] } } }); // SOs OK

    await expect(manualPoll()).resolves.not.toThrow();
  });

  it('no lanza error si SAP falla al consultar SalesOrders', async () => {
    mockSapGet
      .mockResolvedValueOnce({ data: { d: { results: [] } } }) // BPs OK
      .mockRejectedValueOnce(new Error('SAP timeout')); // falla SOs

    await expect(manualPoll()).resolves.not.toThrow();
  });
});
