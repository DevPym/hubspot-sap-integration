/**
 * Tests extendidos para hubspot.routes.ts — Gaps de cobertura.
 *
 * Verifica:
 * - associationChange Deal↔Company → encola sync del Deal
 * - associationChange Company→Deal (dirección inversa)
 * - associationRemoved → SKIP
 * - associationChange Contact↔Company → SKIP (no soportada en v1)
 * - Eventos sin objectId → SKIP
 * - Merge events → SKIP
 * - Restore events → SKIP
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddSyncJob = vi.fn().mockResolvedValue({ id: 'mock-job' });

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    name: string;
    add = vi.fn();
    close = vi.fn();
    constructor(name: string) { this.name = name; }
  },
}));

vi.mock('../src/config/env', () => ({
  env: {
    REDIS_URL: 'redis://localhost:6379',
    MAX_RETRY_ATTEMPTS: 5,
    PORT: 3000,
    NODE_ENV: 'test',
    HUBSPOT_CLIENT_SECRET: 'test-secret',
  },
}));

vi.mock('../src/api/middleware/auth.middleware', () => ({
  verifyHubSpotSignature: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../src/queue/sync.queue', () => ({
  QUEUE_NAME: 'hubspot-sap-sync',
  syncQueue: { add: vi.fn(), close: vi.fn(), name: 'hubspot-sap-sync' },
  addSyncJob: (...args: unknown[]) => mockAddSyncJob(...args),
  closeSyncQueue: vi.fn(),
}));

import hubspotRoutes from '../src/api/routes/hubspot.routes';

// ---------------------------------------------------------------------------
// App de test
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhooks', hubspotRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures — Eventos de asociación
// ---------------------------------------------------------------------------

const baseEvent = {
  eventId: 100,
  subscriptionId: 200,
  portalId: 8562853,
  appId: 300,
  occurredAt: 1700000000000,
  attemptNumber: 0,
};

/** Deal→Company association created */
const dealToCompanyAssociation = {
  ...baseEvent,
  eventId: 101,
  subscriptionType: 'deal.associationChange',
  fromObjectTypeId: '0-3',   // Deal
  toObjectTypeId: '0-2',     // Company
  fromObjectId: 58247306498,
  toObjectId: 53147869965,
  associationRemoved: false,
};

/** Company→Deal association (dirección inversa, llega como deal.associationChange) */
const companyToDealAssociation = {
  ...baseEvent,
  eventId: 102,
  subscriptionType: 'deal.associationChange',
  fromObjectTypeId: '0-2',   // Company
  toObjectTypeId: '0-3',     // Deal
  fromObjectId: 53147869965,
  toObjectId: 58247306498,
  associationRemoved: false,
};

/** Association removed */
const associationRemoved = {
  ...dealToCompanyAssociation,
  eventId: 103,
  associationRemoved: true,
};

/** Contact↔Company association (no es Deal↔Company, se salta como deal.associationChange genérico) */
const contactToCompanyAssociation = {
  ...baseEvent,
  eventId: 104,
  subscriptionType: 'deal.associationChange',
  fromObjectTypeId: '0-1',   // Contact
  toObjectTypeId: '0-2',     // Company
  fromObjectId: 210581802294,
  toObjectId: 53147869965,
  associationRemoved: false,
};

/** Merge event (HubSpot usa object.merge, no contact.merge) */
const mergeEvent = {
  ...baseEvent,
  eventId: 105,
  subscriptionType: 'object.merge',
  objectId: 12345,
};

/** Restore event */
const restoreEvent = {
  ...baseEvent,
  eventId: 106,
  subscriptionType: 'object.restore',
  objectId: 12345,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/hubspot — associationChange events', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('encola sync del Deal cuando llega associationChange Deal→Company', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([dealToCompanyAssociation]);

    expect(res.status).toBe(200);
    expect(res.body.enqueued).toBe(1);
    expect(res.body.skipped).toBe(0);

    expect(mockAddSyncJob).toHaveBeenCalledWith({
      objectId: '58247306498', // fromObjectId (el Deal)
      entityType: 'DEAL',
      occurredAt: 1700000000000,
      subscriptionType: 'deal.associationChange',
    });
  });

  it('encola sync del Deal cuando la dirección es Company→Deal', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([companyToDealAssociation]);

    expect(res.status).toBe(200);
    expect(res.body.enqueued).toBe(1);

    expect(mockAddSyncJob).toHaveBeenCalledWith({
      objectId: '58247306498', // toObjectId (el Deal)
      entityType: 'DEAL',
      occurredAt: 1700000000000,
      subscriptionType: 'deal.associationChange',
    });
  });

  it('SKIP cuando associationRemoved=true', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([associationRemoved]);

    expect(res.status).toBe(200);
    expect(res.body.enqueued).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(mockAddSyncJob).not.toHaveBeenCalled();
  });

  it('SKIP para asociación Contact↔Company (no es Deal↔Company)', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([contactToCompanyAssociation]);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(mockAddSyncJob).not.toHaveBeenCalled();
  });

  it('mezcla asociationChange + eventos normales correctamente', async () => {
    const normalContactEvent = {
      ...baseEvent,
      eventId: 107,
      subscriptionType: 'contact.propertyChange',
      objectId: 210581802294,
      propertyName: 'firstname',
      propertyValue: 'Carlos',
    };

    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([dealToCompanyAssociation, normalContactEvent]);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(2);
    expect(res.body.enqueued).toBe(2);
    expect(mockAddSyncJob).toHaveBeenCalledTimes(2);

    // Verificar tipos
    const calls = mockAddSyncJob.mock.calls;
    expect(calls[0][0].entityType).toBe('DEAL');
    expect(calls[1][0].entityType).toBe('CONTACT');
  });
});

describe('POST /webhooks/hubspot — merge y restore events', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('SKIP merge events', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([mergeEvent]);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(mockAddSyncJob).not.toHaveBeenCalled();
  });

  it('SKIP restore events', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([restoreEvent]);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(mockAddSyncJob).not.toHaveBeenCalled();
  });
});
