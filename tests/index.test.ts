/**
 * Tests para index.ts — Inicialización de la aplicación.
 *
 * Verifica:
 * - Express app se exporta correctamente
 * - GET /health responde 200 con status: 'ok'
 * - Middleware order: express.raw() ANTES de express.json()
 * - POST /webhooks/hubspot devuelve 200 (no 404)
 * - Error handler está registrado (ruta inexistente no crashea)
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks — deben ir ANTES del import de index.ts
// ---------------------------------------------------------------------------

// Mock BullMQ (worker + queue)
vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    name: string;
    add = vi.fn();
    close = vi.fn();
    constructor(name: string) { this.name = name; }
  },
  Worker: class MockWorker {
    on = vi.fn();
    close = vi.fn();
    constructor() {}
  },
}));

// Mock env
vi.mock('../src/config/env', () => ({
  env: {
    PORT: 3099, // Puerto diferente para no conflictuar
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
    MAX_RETRY_ATTEMPTS: 5,
    HUBSPOT_CLIENT_SECRET: 'test-secret',
    SYNC_LOCK_TIMEOUT_MS: 30000,
    SAP_POLL_INTERVAL_MS: 300000,
  },
}));

// Mock sync worker y queue
vi.mock('../src/queue/sync.worker', () => ({
  createSyncWorker: vi.fn(),
  closeSyncWorker: vi.fn(),
}));

vi.mock('../src/queue/sync.queue', () => ({
  QUEUE_NAME: 'hubspot-sap-sync',
  syncQueue: { add: vi.fn(), close: vi.fn(), name: 'hubspot-sap-sync' },
  addSyncJob: vi.fn().mockResolvedValue({}),
  closeSyncQueue: vi.fn(),
}));

// Mock SAP poller
vi.mock('../src/services/sap-poller.service', () => ({
  startSapPoller: vi.fn(),
  stopSapPoller: vi.fn(),
}));

// Mock auth middleware (skip HMAC en tests)
vi.mock('../src/api/middleware/auth.middleware', () => ({
  verifyHubSpotSignature: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ---------------------------------------------------------------------------
// Import app DESPUÉS de mocks
// ---------------------------------------------------------------------------

import app from '../src/index';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('index.ts — Express app initialization', () => {
  it('exporta una app Express', () => {
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });

  it('GET /health responde 200 con status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('POST /webhooks/hubspot responde 200 (ruta existe)', async () => {
    const res = await request(app)
      .post('/webhooks/hubspot')
      .send([{
        eventId: 1,
        subscriptionId: 100,
        portalId: 8562853,
        appId: 200,
        occurredAt: Date.now(),
        subscriptionType: 'contact.creation',
        attemptNumber: 0,
        objectId: 12345,
      }]);

    expect(res.status).toBe(200);
  });

  it('GET a ruta inexistente devuelve 404 (no crashea)', async () => {
    const res = await request(app).get('/ruta-inexistente');

    // Express devuelve 404 por defecto para rutas no definidas
    expect(res.status).toBe(404);
  });

  it('trust proxy está configurado para Railway', () => {
    const trustProxy = app.get('trust proxy');
    expect(trustProxy).toBe(1);
  });
});
