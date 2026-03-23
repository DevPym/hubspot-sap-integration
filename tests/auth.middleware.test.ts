/**
 * Tests para src/api/middleware/auth.middleware.ts
 *
 * Testea la verificación HMAC-SHA256 v3 de webhooks HubSpot:
 * - Firma válida → next() (pasa al handler)
 * - Firma inválida → 401
 * - Headers faltantes → 401
 * - Timestamp expirado → 401 (anti-replay)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { verifyHubSpotSignature } from '../src/api/middleware/auth.middleware';

// ---------------------------------------------------------------------------
// Mock de env.ts para evitar process.exit(1) en tests
// ---------------------------------------------------------------------------

vi.mock('../src/config/env', () => ({
  env: {
    HUBSPOT_CLIENT_SECRET: 'test-secret-key-12345',
  },
}));

// ---------------------------------------------------------------------------
// Helpers para construir mocks de Express
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-secret-key-12345';

/** Genera una firma HMAC-SHA256 v3 válida para un request simulado */
function generateSignature(
  method: string,
  url: string,
  body: string,
  timestamp: string,
): string {
  const sourceString = `${method}${url}${body}${timestamp}`;
  return crypto
    .createHmac('sha256', TEST_SECRET)
    .update(sourceString, 'utf8')
    .digest('base64');
}

/** Crea un mock de Request de Express con los datos necesarios */
function createMockRequest(overrides: {
  signature?: string;
  timestamp?: string;
  body?: Buffer | string;
  method?: string;
  protocol?: string;
  host?: string;
  originalUrl?: string;
}): Partial<Request> {
  const headers: Record<string, string> = {};
  if (overrides.signature) headers['x-hubspot-signature-v3'] = overrides.signature;
  if (overrides.timestamp) headers['x-hubspot-request-timestamp'] = overrides.timestamp;

  return {
    method: overrides.method ?? 'POST',
    protocol: overrides.protocol ?? 'https',
    originalUrl: overrides.originalUrl ?? '/webhooks/hubspot',
    body: overrides.body ?? Buffer.from('[]'),
    headers,
    get: vi.fn((name: string) => {
      if (name.toLowerCase() === 'host') return overrides.host ?? 'app.railway.app';
      return undefined;
    }),
  };
}

/** Crea un mock de Response de Express */
function createMockResponse(): Partial<Response> & { _statusCode: number; _body: unknown } {
  const res: Partial<Response> & { _statusCode: number; _body: unknown } = {
    _statusCode: 200,
    _body: null,
    status(code: number) {
      res._statusCode = code;
      return res as Response;
    },
    json(body: unknown) {
      res._body = body;
      return res as Response;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyHubSpotSignature', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('acepta un request con firma válida y llama next()', () => {
    const timestamp = Date.now().toString();
    const body = '[{"eventId":1001}]';
    const url = 'https://app.railway.app/webhooks/hubspot';
    const signature = generateSignature('POST', url, body, timestamp);

    const req = createMockRequest({
      signature,
      timestamp,
      body: Buffer.from(body),
    });
    const res = createMockResponse();

    verifyHubSpotSignature(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._statusCode).toBe(200); // no se modificó
  });

  it('rechaza con 401 si falta X-HubSpot-Signature-v3', () => {
    const req = createMockRequest({
      timestamp: Date.now().toString(),
      // sin signature
    });
    const res = createMockResponse();

    verifyHubSpotSignature(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(401);
  });

  it('rechaza con 401 si falta X-HubSpot-Request-Timestamp', () => {
    const req = createMockRequest({
      signature: 'some-signature',
      // sin timestamp
    });
    const res = createMockResponse();

    verifyHubSpotSignature(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(401);
  });

  it('rechaza con 401 si el timestamp tiene más de 5 minutos (anti-replay)', () => {
    const oldTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 min atrás
    const body = '[]';
    const url = 'https://app.railway.app/webhooks/hubspot';
    const signature = generateSignature('POST', url, body, oldTimestamp);

    const req = createMockRequest({
      signature,
      timestamp: oldTimestamp,
      body: Buffer.from(body),
    });
    const res = createMockResponse();

    verifyHubSpotSignature(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(401);
    expect((res._body as { message: string }).message).toContain('expirado');
  });

  it('rechaza con 401 si la firma es incorrecta', () => {
    const timestamp = Date.now().toString();

    const req = createMockRequest({
      signature: 'firma-totalmente-incorrecta',
      timestamp,
      body: Buffer.from('[]'),
    });
    const res = createMockResponse();

    verifyHubSpotSignature(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(401);
  });

  it('rechaza con 401 si el body fue alterado después de firmar', () => {
    const timestamp = Date.now().toString();
    const originalBody = '[{"eventId":1001}]';
    const url = 'https://app.railway.app/webhooks/hubspot';
    // Firma calculada con el body original
    const signature = generateSignature('POST', url, originalBody, timestamp);

    // Pero el body que llega es diferente (alterado)
    const req = createMockRequest({
      signature,
      timestamp,
      body: Buffer.from('[{"eventId":9999}]'),
    });
    const res = createMockResponse();

    verifyHubSpotSignature(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(401);
  });

  it('acepta body como string (además de Buffer)', () => {
    const timestamp = Date.now().toString();
    const body = '[{"eventId":1001}]';
    const url = 'https://app.railway.app/webhooks/hubspot';
    const signature = generateSignature('POST', url, body, timestamp);

    const req = createMockRequest({
      signature,
      timestamp,
      body, // string, no Buffer
    });
    const res = createMockResponse();

    verifyHubSpotSignature(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
