/**
 * sap.client.ts — Cliente HTTP para la API SAP S/4HANA Cloud OData v2.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Autenticación Basic Auth (SAP_USERNAME + SAP_PASSWORD)              │
 * │  2. Gestión automática de CSRF token:                                   │
 * │     - Obtención via HEAD + x-csrf-token:fetch                           │
 * │     - Cache de 25 min (TTL defensivo < 30 min real de SAP)              │
 * │     - Refresco automático en 403 (1 reintento)                          │
 * │  3. Gestión de ETag para PATCH:                                         │
 * │     - GET previo para obtener ETag del recurso                          │
 * │     - Inyección del header If-Match en el PATCH                         │
 * │  4. Headers OData v2 estándar en cada request                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Lee de:                                                                │
 * │    - src/config/env.ts → SAP_BASE_URL, SAP_USERNAME, SAP_PASSWORD       │
 * │                                                                         │
 * │  Usa tipos de:                                                          │
 * │    - src/adapters/sap/sap.types.ts → ODataResponse<T>                   │
 * │                                                                         │
 * │  Consumido por (Fases futuras):                                         │
 * │    - src/services/sync.service.ts  → crear/actualizar BP y SalesOrder   │
 * │    - src/services/mapper.service.ts → leer BP/SO para obtener datos     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLUJO CSRF                                                             │
 * │  ──────────                                                             │
 * │  1ª escritura:                                                          │
 * │    HEAD /endpoint → x-csrf-token:fetch → SAP devuelve token + cookies   │
 * │    → cachear token (25 min)                                             │
 * │    → POST/PATCH con x-csrf-token + cookies → éxito                      │
 * │                                                                         │
 * │  Si 403 (token expirado):                                               │
 * │    → invalidar cache → HEAD (nuevo token) → reintentar 1 vez           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  HALLAZGOS VERIFICADOS EN PRODUCCIÓN                                    │
 * │  ────────────────────────────────────                                   │
 * │  - PATCH devuelve 204 sin body                                          │
 * │  - $expand NO funciona con $select en OData v2                          │
 * │  - ETag de BP = string plano                                            │
 * │  - ETag de SalesOrder = W/"datetimeoffset'...'"                         │
 * │  - Teléfonos: NO incluir código país en PhoneNumber                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { env } from '../../config/env';

// ---------------------------------------------------------------------------
// Cache de CSRF token
// ---------------------------------------------------------------------------

/** TTL defensivo: 25 minutos (SAP invalida a los ~30 min reales) */
const CSRF_TTL_MS = 25 * 60 * 1000;

interface CsrfCache {
  token: string;
  cookies: string[];
  fetchedAt: number;
}

let csrfCache: CsrfCache | null = null;

/**
 * Verifica si el CSRF token cacheado sigue vigente.
 * Retorna true si existe y no ha expirado.
 */
function isCsrfValid(): boolean {
  if (!csrfCache) return false;
  return Date.now() - csrfCache.fetchedAt < CSRF_TTL_MS;
}

/** Invalida el CSRF cache (usado cuando SAP responde 403) */
function invalidateCsrf(): void {
  csrfCache = null;
}

// ---------------------------------------------------------------------------
// Instancia Axios base
// ---------------------------------------------------------------------------

/**
 * Crea la instancia Axios con:
 * - Basic Auth permanente (SAP_USERNAME:SAP_PASSWORD)
 * - Headers OData v2 estándar
 * - Timeout de 30 segundos por request
 */
function createAxiosInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL: env.SAP_BASE_URL,
    timeout: 30_000,
    auth: {
      username: env.SAP_USERNAME,
      password: env.SAP_PASSWORD,
    },
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  // --- Interceptor REQUEST: inyectar CSRF token en operaciones de escritura ---
  instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const method = config.method?.toUpperCase();

    // Solo POST, PATCH, DELETE necesitan CSRF
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      // Obtener token si no hay uno válido en cache
      if (!isCsrfValid()) {
        await fetchCsrfToken(instance);
      }

      // Inyectar token y cookies en el request
      if (csrfCache) {
        config.headers['x-csrf-token'] = csrfCache.token;
        config.headers['Cookie'] = csrfCache.cookies.join('; ');
      }
    }

    return config;
  });

  // --- Interceptor RESPONSE: retry automático en 403 (CSRF expirado) ---
  instance.interceptors.response.use(
    // Respuestas exitosas pasan sin cambios
    (response: AxiosResponse) => response,

    // En error, verificar si es 403 y si vale la pena reintentar
    async (error) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _csrfRetried?: boolean };

      // Condiciones para reintentar:
      // 1. Es un 403 (CSRF expirado)
      // 2. No es un GET/HEAD (esos no usan CSRF)
      // 3. No se ha reintentado ya (flag _csrfRetried)
      const method = originalRequest?.method?.toUpperCase();
      const isWriteOp = method === 'POST' || method === 'PATCH' || method === 'DELETE';

      if (
        error.response?.status === 403 &&
        isWriteOp &&
        !originalRequest._csrfRetried
      ) {
        // Marcar como reintentado para no entrar en loop infinito
        originalRequest._csrfRetried = true;

        // Invalidar cache, obtener nuevo token y reintentar
        invalidateCsrf();
        await fetchCsrfToken(instance);

        // Reinyectar el nuevo token en el request original
        if (csrfCache) {
          originalRequest.headers['x-csrf-token'] = csrfCache.token;
          originalRequest.headers['Cookie'] = csrfCache.cookies.join('; ');
        }

        return instance.request(originalRequest);
      }

      // Si no es un caso de retry, propagar el error
      return Promise.reject(error);
    },
  );

  return instance;
}

// ---------------------------------------------------------------------------
// Obtención de CSRF token
// ---------------------------------------------------------------------------

/**
 * Hace un HEAD request para obtener el CSRF token de SAP.
 *
 * SAP responde con:
 *   - Header `x-csrf-token`: el token a usar en POST/PATCH/DELETE
 *   - Header `set-cookie`: cookies de sesión que deben reenviarse
 *
 * El endpoint usado para el fetch es la raíz de la API de Business Partner
 * (cualquier endpoint válido sirve, pero este es ligero).
 */
async function fetchCsrfToken(instance: AxiosInstance): Promise<void> {
  const response = await instance.head(
    '/API_BUSINESS_PARTNER/A_BusinessPartner',
    {
      headers: {
        'x-csrf-token': 'fetch',
      },
    },
  );

  const token = response.headers['x-csrf-token'];
  // set-cookie puede ser string o string[] según el servidor
  const setCookieHeader = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [];

  if (token) {
    csrfCache = {
      token,
      cookies,
      fetchedAt: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Cliente SAP — métodos públicos
// ---------------------------------------------------------------------------

/** Instancia Axios interna (lazy initialization) */
let axiosInstance: AxiosInstance | null = null;

function getInstance(): AxiosInstance {
  if (!axiosInstance) {
    axiosInstance = createAxiosInstance();
  }
  return axiosInstance;
}

/**
 * Cliente SAP singleton.
 *
 * Ejemplo de uso:
 *   // Leer un BP
 *   const response = await sapClient.get('/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')');
 *   const bp = response.data.d;
 *
 *   // Crear un BP (CSRF se maneja automáticamente)
 *   await sapClient.post('/API_BUSINESS_PARTNER/A_BusinessPartner', payload);
 *
 *   // Actualizar un BP (usa patchWithETag para manejo automático de ETag)
 *   await sapClient.patchWithETag('/API_BUSINESS_PARTNER/A_BusinessPartner(\'100000031\')', payload);
 */
export const sapClient = {
  /**
   * GET — leer un recurso de SAP.
   * No requiere CSRF ni ETag.
   */
  async get<T = unknown>(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getInstance().get<T>(path, config);
  },

  /**
   * POST — crear un recurso en SAP.
   * El CSRF token se inyecta automáticamente via interceptor.
   */
  async post<T = unknown>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getInstance().post<T>(path, data, config);
  },

  /**
   * PATCH — actualizar un recurso en SAP (sin manejo automático de ETag).
   * Útil cuando ya tienes el ETag y quieres pasarlo manualmente.
   *
   * ⚠️ Requiere header If-Match con el ETag del recurso.
   * ⚠️ SAP responde 204 sin body.
   */
  async patch(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return getInstance().patch(path, data, config);
  },

  /**
   * PATCH con manejo automático de ETag.
   *
   * Flujo completo:
   *   1. GET al recurso para obtener el ETag actual
   *   2. PATCH con header If-Match: {etag}
   *
   * Este es el método recomendado para actualizaciones — evita tener que
   * hacer el GET manual y extraer el ETag.
   *
   * @param path Ruta OData del recurso (ej: "/API_BUSINESS_PARTNER/A_BusinessPartner('100000031')")
   * @param data Payload de actualización (solo campos que cambian)
   * @returns La respuesta del PATCH (204 sin body)
   */
  async patchWithETag(path: string, data?: unknown): Promise<AxiosResponse> {
    // Paso 1: GET para obtener ETag
    const getResponse = await getInstance().get(path);
    const etag = getResponse.headers['etag'];

    if (!etag) {
      throw new Error(`[sap.client] No se recibió ETag de SAP para ${path}. No se puede hacer PATCH seguro.`);
    }

    // Paso 2: PATCH con If-Match
    return getInstance().patch(path, data, {
      headers: {
        'If-Match': etag,
      },
    });
  },

  /**
   * DELETE — eliminar un recurso de SAP.
   * El CSRF token se inyecta automáticamente.
   * Raramente usado en v1 (la spec no incluye DELETE en las operaciones).
   */
  async delete(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return getInstance().delete(path, config);
  },

  // --- Utilidades para testing ---

  /** Invalida el CSRF cache manualmente (útil en tests) */
  _invalidateCsrf: invalidateCsrf,

  /** Resetea la instancia Axios (útil en tests para aislar estado) */
  _resetInstance(): void {
    axiosInstance = null;
    csrfCache = null;
  },
};
