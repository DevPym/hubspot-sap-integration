/**
 * Tests para src/api/middleware/error.middleware.ts
 *
 * Testea el manejador centralizado de errores:
 * - AxiosError → 502/504 (errores de APIs externas)
 * - ZodError → 422 (validación fallida)
 * - Error genérico → 500
 * - Modo development vs production (detalles ocultos)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { AxiosError, AxiosHeaders } from 'axios';
import { ZodError, ZodIssueCode } from 'zod';
import { errorHandler } from '../src/api/middleware/error.middleware';

// ---------------------------------------------------------------------------
// Helpers para mocks de Express
// ---------------------------------------------------------------------------

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

const mockReq = {} as Request;
const mockNext = vi.fn() as NextFunction;

// ---------------------------------------------------------------------------
// Control de NODE_ENV
// ---------------------------------------------------------------------------

let originalNodeEnv: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

// ---------------------------------------------------------------------------
// Tests — AxiosError
// ---------------------------------------------------------------------------

describe('errorHandler — AxiosError (APIs externas)', () => {
  it('responde 502 para errores HTTP de APIs externas', () => {
    process.env.NODE_ENV = 'development';
    const res = createMockResponse();

    const axiosError = new AxiosError(
      'Request failed with status code 500',
      'ERR_BAD_RESPONSE',
      { url: '/API_BUSINESS_PARTNER', headers: new AxiosHeaders() } as never,
      {},
      {
        status: 500,
        statusText: 'Internal Server Error',
        data: { error: 'SAP internal error' },
        headers: {},
        config: { headers: new AxiosHeaders() },
      },
    );

    errorHandler(axiosError, mockReq, res as Response, mockNext);

    expect(res._statusCode).toBe(502);
    const body = res._body as { error: string; message: string; details: unknown };
    expect(body.error).toBe('Bad Gateway');
    expect(body.message).toContain('500');
    expect(body.details).toBeDefined();
  });

  it('responde 504 para errores de timeout', () => {
    process.env.NODE_ENV = 'development';
    const res = createMockResponse();

    const timeoutError = new AxiosError(
      'timeout of 30000ms exceeded',
      'ECONNABORTED',
      { url: '/API_SALES_ORDER_SRV', timeout: 30000, headers: new AxiosHeaders() } as never,
    );

    errorHandler(timeoutError, mockReq, res as Response, mockNext);

    expect(res._statusCode).toBe(504);
    const body = res._body as { error: string; message: string };
    expect(body.error).toBe('Gateway Timeout');
    expect(body.message).toContain('Timeout');
  });

  it('oculta detalles en producción', () => {
    process.env.NODE_ENV = 'production';
    const res = createMockResponse();

    const axiosError = new AxiosError(
      'Request failed',
      'ERR_BAD_RESPONSE',
      { url: '/API_BUSINESS_PARTNER', headers: new AxiosHeaders() } as never,
      {},
      {
        status: 500,
        statusText: 'Internal Server Error',
        data: { secreto: 'datos-internos-sap' },
        headers: {},
        config: { headers: new AxiosHeaders() },
      },
    );

    errorHandler(axiosError, mockReq, res as Response, mockNext);

    expect(res._statusCode).toBe(502);
    const body = res._body as { error: string; message: string; details?: unknown };
    expect(body.message).toBe('Error al comunicarse con servicio externo');
    expect(body.details).toBeUndefined(); // no expone datos internos
  });
});

// ---------------------------------------------------------------------------
// Tests — ZodError
// ---------------------------------------------------------------------------

describe('errorHandler — ZodError (validación)', () => {
  it('responde 422 para errores de validación Zod', () => {
    process.env.NODE_ENV = 'development';
    const res = createMockResponse();

    const zodError = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'number',
        received: 'string',
        path: ['objectId'],
        message: 'Expected number, received string',
      },
    ]);

    errorHandler(zodError, mockReq, res as Response, mockNext);

    expect(res._statusCode).toBe(422);
    const body = res._body as { error: string; details: { issues: unknown[] } };
    expect(body.error).toBe('Unprocessable Entity');
    expect(body.details.issues).toHaveLength(1);
  });

  it('oculta issues en producción', () => {
    process.env.NODE_ENV = 'production';
    const res = createMockResponse();

    const zodError = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: 'number',
        received: 'string',
        path: ['objectId'],
        message: 'Expected number, received string',
      },
    ]);

    errorHandler(zodError, mockReq, res as Response, mockNext);

    expect(res._statusCode).toBe(422);
    const body = res._body as { error: string; details?: unknown };
    expect(body.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Error genérico
// ---------------------------------------------------------------------------

describe('errorHandler — Error genérico', () => {
  it('responde 500 para errores desconocidos', () => {
    process.env.NODE_ENV = 'development';
    const res = createMockResponse();

    const genericError = new Error('Algo inesperado ocurrió');

    errorHandler(genericError, mockReq, res as Response, mockNext);

    expect(res._statusCode).toBe(500);
    const body = res._body as { error: string; message: string; details: { stack: string } };
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('Algo inesperado ocurrió');
    expect(body.details.stack).toBeDefined();
  });

  it('oculta mensaje y stack en producción', () => {
    process.env.NODE_ENV = 'production';
    const res = createMockResponse();

    const genericError = new Error('Detalle sensible que no debería exponerse');

    errorHandler(genericError, mockReq, res as Response, mockNext);

    expect(res._statusCode).toBe(500);
    const body = res._body as { error: string; message: string; details?: unknown };
    expect(body.message).toBe('Error interno del servidor');
    expect(body.details).toBeUndefined();
  });
});
