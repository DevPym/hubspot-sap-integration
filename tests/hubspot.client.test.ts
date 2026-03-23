/**
 * Tests para src/adapters/hubspot/hubspot.client.ts
 *
 * Testea el cliente HTTP de HubSpot con mocks de Axios:
 * - GET, POST, PATCH, DELETE básicos
 * - Creación de instancia con Bearer Token
 * - Registro de interceptor de response (retry 429)
 * - Reseteo de instancia
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Mock de env.ts
// ---------------------------------------------------------------------------

vi.mock('../src/config/env', () => ({
  env: {
    HUBSPOT_ACCESS_TOKEN: 'pat-na1-test-token-12345',
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
    interceptors,
  };

  return {
    default: {
      create: vi.fn(() => instance),
    },
  };
});

import { hubspotClient } from '../src/adapters/hubspot/hubspot.client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** El mock de axios.create siempre retorna el mismo objeto instance */
const mockedInstance = (axios.create as ReturnType<typeof vi.fn>)();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hubspotClient', () => {
  beforeEach(() => {
    hubspotClient._resetInstance();
    vi.clearAllMocks();
  });

  describe('creación de instancia', () => {
    it('crea instancia Axios con Bearer Token y baseURL de HubSpot', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: {}, headers: {} });

      await hubspotClient.get('/crm/v3/objects/contacts');

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.hubapi.com',
          timeout: 15_000,
          headers: expect.objectContaining({
            'Authorization': 'Bearer pat-na1-test-token-12345',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('registra interceptor de response para retry 429', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: {}, headers: {} });

      await hubspotClient.get('/test');

      // Solo interceptor de response (no request como SAP)
      expect(instance.interceptors.response.use).toHaveBeenCalledOnce();
    });
  });

  describe('get()', () => {
    it('ejecuta GET y retorna la respuesta', async () => {
      const mockContact = {
        id: '210581802294',
        properties: { firstname: 'Juan', lastname: 'Pérez' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T10:30:00Z',
        archived: false,
      };
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: mockContact, status: 200 });

      const response = await hubspotClient.get('/crm/v3/objects/contacts/210581802294');

      expect(instance.get).toHaveBeenCalledWith(
        '/crm/v3/objects/contacts/210581802294',
        undefined,
      );
      expect(response.data).toEqual(mockContact);
    });

    it('pasa query params (properties, associations)', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValueOnce({ data: {}, status: 200 });

      const config = { params: { properties: 'firstname,lastname,email' } };
      await hubspotClient.get('/crm/v3/objects/contacts/210581802294', config);

      expect(instance.get).toHaveBeenCalledWith(
        '/crm/v3/objects/contacts/210581802294',
        config,
      );
    });
  });

  describe('post()', () => {
    it('ejecuta POST con payload y retorna objeto creado', async () => {
      const payload = {
        properties: { firstname: 'María', lastname: 'González', email: 'maria@test.com' },
      };
      const instance = mockedInstance;
      instance.post.mockResolvedValueOnce({
        data: { id: '999999', properties: payload.properties },
        status: 201,
      });

      const response = await hubspotClient.post('/crm/v3/objects/contacts', payload);

      expect(instance.post).toHaveBeenCalledWith(
        '/crm/v3/objects/contacts',
        payload,
        undefined,
      );
      expect(response.status).toBe(201);
      expect(response.data.id).toBe('999999');
    });
  });

  describe('patch()', () => {
    it('ejecuta PATCH y retorna objeto actualizado completo (200)', async () => {
      const payload = { properties: { firstname: 'Carlos' } };
      const instance = mockedInstance;
      instance.patch.mockResolvedValueOnce({
        data: {
          id: '210581802294',
          properties: { firstname: 'Carlos', lastname: 'Pérez', email: 'carlos@test.com' },
        },
        status: 200,
      });

      const response = await hubspotClient.patch(
        '/crm/v3/objects/contacts/210581802294',
        payload,
      );

      expect(instance.patch).toHaveBeenCalledWith(
        '/crm/v3/objects/contacts/210581802294',
        payload,
        undefined,
      );
      // HubSpot PATCH devuelve 200 con objeto completo (a diferencia de SAP que devuelve 204)
      expect(response.status).toBe(200);
      expect(response.data.properties.firstname).toBe('Carlos');
    });
  });

  describe('delete()', () => {
    it('ejecuta DELETE (archivar objeto)', async () => {
      const instance = mockedInstance;
      instance.delete.mockResolvedValueOnce({ status: 204, data: '' });

      const response = await hubspotClient.delete('/crm/v3/objects/contacts/210581802294');

      expect(instance.delete).toHaveBeenCalledWith(
        '/crm/v3/objects/contacts/210581802294',
        undefined,
      );
      expect(response.status).toBe(204);
    });
  });

  describe('_resetInstance()', () => {
    it('permite crear una instancia nueva después de reset', async () => {
      const instance = mockedInstance;
      instance.get.mockResolvedValue({ data: {}, headers: {} });

      await hubspotClient.get('/test1');
      hubspotClient._resetInstance();
      await hubspotClient.get('/test2');

      expect(axios.create).toHaveBeenCalledTimes(2);
    });
  });
});
