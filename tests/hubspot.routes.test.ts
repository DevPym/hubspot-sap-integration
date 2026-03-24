/**
 * Tests para hubspot.routes.ts — Ruta POST /webhooks/hubspot.
 *
 * Mockea: auth.middleware, sync.queue, env, BullMQ.
 * Testea: parsing del payload, clasificación de eventos, encolado.
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

// Skip HMAC verification en tests (se testea por separado en auth.middleware.test.ts)
vi.mock('../src/api/middleware/auth.middleware', () => ({
  verifyHubSpotSignature: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../src/queue/sync.queue', () => ({
  QUEUE_NAME: 'hubspot-sap-sync',
  syncQueue: { add: vi.fn(), close: vi.fn(), name: 'hubspot-sap-sync' },
  addSyncJob: (...args: unknown[]) => mockAddSyncJob(...args),
  closeSyncQueue: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import DESPUÉS de los mocks
// ---------------------------------------------------------------------------

import hubspotRoutes from '../src/api/routes/hubspot.routes';

// ---------------------------------------------------------------------------
// App de test
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  // Simular express.raw() + luego json para la ruta de webhooks
  app.use(express.json());
  app.use('/webhooks', hubspotRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validContactEvent = {
  eventId: 1,
  subscriptionId: 100,
  portalId: 8562853,
  appId: 200,
  occurredAt: 1700000000000,
  subscriptionType: 'contact.propertyChange',
  attemptNumber: 0,
  objectId: 12345,
  propertyName: 'firstname',
  propertyValue: 'Juan',
};

const validCompanyEvent = {
  ...validContactEvent,
  eventId: 2,
  subscriptionType: 'company.creation',
  objectId: 67890,
};

const validDealEvent = {
  ...validContactEvent,
  eventId: 3,
  subscriptionType: 'deal.propertyChange',
  objectId: 99999,
};

const deletionEvent = {
  ...validContactEvent,
  eventId: 4,
  subscriptionType: 'contact.deletion',
  objectId: 11111,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/hubspot', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('encola un evento de Contact y responde 200', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([validContactEvent]);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(1);
    expect(res.body.enqueued).toBe(1);
    expect(res.body.skipped).toBe(0);

    expect(mockAddSyncJob).toHaveBeenCalledWith({
      objectId: '12345',    // Convertido a string
      entityType: 'CONTACT',
      occurredAt: 1700000000000,
      subscriptionType: 'contact.propertyChange',
    });
  });

  it('encola múltiples eventos de diferentes tipos', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([validContactEvent, validCompanyEvent, validDealEvent]);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(3);
    expect(res.body.enqueued).toBe(3);
    expect(mockAddSyncJob).toHaveBeenCalledTimes(3);

    // Verificar que cada tipo de entidad se clasificó correctamente
    const calls = mockAddSyncJob.mock.calls;
    expect(calls[0][0].entityType).toBe('CONTACT');
    expect(calls[1][0].entityType).toBe('COMPANY');
    expect(calls[2][0].entityType).toBe('DEAL');
  });

  it('salta eventos de deletion (v1 no sincroniza deletes)', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([validContactEvent, deletionEvent]);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(2);
    expect(res.body.enqueued).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(mockAddSyncJob).toHaveBeenCalledTimes(1);
  });

  it('rechaza payload vacío con 400', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([]);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid webhook payload');
  });

  it('rechaza payload malformado con 400', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([{ foo: 'bar' }]);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid webhook payload');
  });

  it('convierte objectId de number a string', async () => {
    await request(app)
      .post('/webhooks/hubspot')
      .send([validContactEvent]);

    const syncEvent = mockAddSyncJob.mock.calls[0][0];
    expect(typeof syncEvent.objectId).toBe('string');
    expect(syncEvent.objectId).toBe('12345');
  });

  it('responde 200 incluso si addSyncJob falla (no reintentar webhook)', async () => {
    mockAddSyncJob.mockRejectedValueOnce(new Error('Redis down'));

    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([validContactEvent]);

    // Debe responder 200 para que HubSpot no reintente
    expect(res.status).toBe(200);
  });
});
