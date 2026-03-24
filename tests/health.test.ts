import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock env y BullMQ para que index.ts no falle al importar
vi.mock('../src/config/env', () => ({
  env: {
    PORT: 3000,
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
    MAX_RETRY_ATTEMPTS: 5,
  },
}));

vi.mock('../src/queue/sync.worker', () => ({
  createSyncWorker: vi.fn(),
  closeSyncWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/queue/sync.queue', () => ({
  closeSyncQueue: vi.fn().mockResolvedValue(undefined),
}));

import app from '../src/index';

describe('GET /health', () => {
  it('debe responder 200 con status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});
