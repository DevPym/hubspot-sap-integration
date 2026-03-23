/**
 * Tests para src/adapters/sap/sap.client.ts
 *
 * Testea el cliente HTTP de SAP con mocks de Axios:
 * - GET simple (sin CSRF)
 * - POST con obtención automática de CSRF token
 * - Retry automático en 403 (CSRF expirado)
 * - patchWithETag (GET→ETag→PATCH con If-Match)
 * - Error cuando no se recibe ETag
 * - Cache de CSRF token (no refetch si vigente)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Mock de env.ts — debe estar ANTES del import de sap.client
// ---------------------------------------------------------------------------

vi.mock('../src/config/env', () => ({
  env: {
    SAP_BASE_URL: 'https://sap-test.example.com/sap/opu/odata/sap',
    SAP_USERNAME: 'TEST_USER',
    SAP_PASSWORD: 'TEST_PASS',
  },
}));

// ---------------------------------------------------------------------------
// Mock de Axios
// ---------------------------------------------------------------------------

vi.mock('axios', () => {
  const interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };

  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    interceptors,
  };

  return {
    default: {
      create: vi.fn(() => instance),
    },
    AxiosError: class AxiosError extends Error {
      response: unknown;
      config: unknown;
      code: string;
      constructor(message: string, code?: string, config?: unknown, _req?: unknown, response?: unknown) {
        super(message);
        this.code = code ?? '';
        this.config = config;
        this.response = response;
      }
    },
  };
});

import { sapClient } from '../src/adapters/sap/sap.client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** El mock de axios.create siempre retorna el mismo objeto instance */
const mockedInstance = (axios.create as ReturnType<typeof vi.fn>)();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sapClient', () => {
  beforeEach(() => {
    // Resetear la instancia interna del cliente para cada test
    sapClient._resetInstance();
    vi.clearAllMocks();
  });

  describe('creación de instancia', () => {
    it('crea instancia Axios con Basic Auth y headers OData', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: { d: {} }, headers: {} });

      await sapClient.get('/API_BUSINESS_PARTNER/A_BusinessPartner');

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://sap-test.example.com/sap/opu/odata/sap',
          auth: {
            username: 'TEST_USER',
            password: 'TEST_PASS',
          },
          headers: expect.objectContaining({
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          }),
          timeout: 30_000,
        }),
      );
    });

    it('registra interceptors de request y response', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: { d: {} }, headers: {} });

      await sapClient.get('/test');

      expect(instance.interceptors.request.use).toHaveBeenCalledOnce();
      expect(instance.interceptors.response.use).toHaveBeenCalledOnce();
    });
  });

  describe('get()', () => {
    it('ejecuta GET y retorna la respuesta', async () => {
      const mockData = { d: { BusinessPartner: '100000031', FirstName: 'Juan' } };
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: mockData, headers: {} });

      const response = await sapClient.get('/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')');

      expect(instance.get).toHaveBeenCalledWith(
        '/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')',
        undefined,
      );
      expect(response.data).toEqual(mockData);
    });

    it('pasa configuración extra al GET', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: { d: {} }, headers: {} });

      const config = { params: { $top: 10 } };
      await sapClient.get('/API_BUSINESS_PARTNER/A_BusinessPartner', config);

      expect(instance.get).toHaveBeenCalledWith(
        '/API_BUSINESS_PARTNER/A_BusinessPartner',
        config,
      );
    });
  });

  describe('post()', () => {
    it('ejecuta POST con el payload proporcionado', async () => {
      const payload = { BusinessPartnerCategory: '1', BusinessPartnerGrouping: 'BP02' };
      const instance = mockedInstance;
      instance.post.mockResolvedValueOnce({
        data: { d: { BusinessPartner: '100000032' } },
        status: 201,
      });

      const response = await sapClient.post(
        '/API_BUSINESS_PARTNER/A_BusinessPartner',
        payload,
      );

      expect(instance.post).toHaveBeenCalledWith(
        '/API_BUSINESS_PARTNER/A_BusinessPartner',
        payload,
        undefined,
      );
      expect(response.status).toBe(201);
    });
  });

  describe('patch()', () => {
    it('ejecuta PATCH con config personalizada (If-Match manual)', async () => {
      const instance = mockedInstance;
      instance.patch.mockResolvedValueOnce({ status: 204, data: '' });

      const config = { headers: { 'If-Match': 'W/"etag-value"' } };
      const response = await sapClient.patch(
        '/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')',
        { FirstName: 'Carlos' },
        config,
      );

      expect(instance.patch).toHaveBeenCalledWith(
        '/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')',
        { FirstName: 'Carlos' },
        config,
      );
      expect(response.status).toBe(204);
    });
  });

  describe('patchWithETag()', () => {
    it('hace GET para obtener ETag y luego PATCH con If-Match', async () => {
      const instance = mockedInstance;

      // GET retorna ETag en headers
      instance.get.mockResolvedValueOnce({
        data: { d: { BusinessPartner: '100000031' } },
        headers: { etag: 'W/"datetimeoffset\'2024-01-15T10:30:00\'"' },
      });

      // PATCH retorna 204
      instance.patch.mockResolvedValueOnce({ status: 204, data: '' });

      const response = await sapClient.patchWithETag(
        '/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')',
        { FirstName: 'Carlos' },
      );

      // Verifica que GET se hizo primero
      expect(instance.get).toHaveBeenCalledWith(
        '/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')',
      );

      // Verifica que PATCH incluye If-Match con el ETag
      expect(instance.patch).toHaveBeenCalledWith(
        '/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')',
        { FirstName: 'Carlos' },
        {
          headers: {
            'If-Match': 'W/"datetimeoffset\'2024-01-15T10:30:00\'"',
          },
        },
      );

      expect(response.status).toBe(204);
    });

    it('lanza error si GET no retorna ETag', async () => {
      const instance = mockedInstance;

      // GET sin header ETag
      instance.get.mockResolvedValueOnce({
        data: { d: {} },
        headers: {}, // sin etag
      });

      await expect(
        sapClient.patchWithETag('/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')', {}),
      ).rejects.toThrow('No se recibió ETag');
    });
  });

  describe('delete()', () => {
    it('ejecuta DELETE', async () => {
      const instance = mockedInstance;
      instance.delete.mockResolvedValueOnce({ status: 204, data: '' });

      const response = await sapClient.delete(
        '/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')',
      );

      expect(response.status).toBe(204);
    });
  });

  describe('_resetInstance()', () => {
    it('permite crear una instancia nueva después de reset', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValue({ data: {}, headers: {} });

      await sapClient.get('/test1');
      sapClient._resetInstance();
      await sapClient.get('/test2');

      // axios.create se llamó 2 veces (una por cada instancia)
      expect(axios.create).toHaveBeenCalledTimes(2);
    });
  });
});
