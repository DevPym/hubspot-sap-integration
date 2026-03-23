/**
 * hubspot.client.ts — Cliente HTTP para la API HubSpot CRM v3.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Autenticación Bearer Token (HUBSPOT_ACCESS_TOKEN de Private App)    │
 * │  2. Retry automático en 429 (Too Many Requests):                        │
 * │     - Lee header Retry-After para saber cuánto esperar                  │
 * │     - Reintenta hasta 3 veces                                           │
 * │     - Si agota los reintentos, propaga el error                         │
 * │  3. Base URL y headers estándar de la API v3                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Lee de:                                                                │
 * │    - src/config/env.ts → HUBSPOT_ACCESS_TOKEN                           │
 * │                                                                         │
 * │  Usa tipos de:                                                          │
 * │    - src/adapters/hubspot/hubspot.types.ts → HubSpotContact, etc.       │
 * │                                                                         │
 * │  Consumido por (Fases futuras):                                         │
 * │    - src/services/sync.service.ts  → leer/actualizar Contacts,          │
 * │      Companies, Deals en HubSpot                                        │
 * │    - src/services/mapper.service.ts → obtener datos + asociaciones      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLUJO RETRY EN 429                                                     │
 * │  ─────────────────                                                      │
 * │  Request → 429 (Retry-After: 2s)                                        │
 * │    → esperar 2s → reintentar                                            │
 * │      → 200 ✅ éxito                                                     │
 * │      → 429 (Retry-After: 1s) → esperar 1s → reintentar                 │
 * │        → 200 ✅ éxito                                                   │
 * │        → 429 → 3 intentos agotados → propagar error ❌                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DIFERENCIAS CLAVE CON SAP                                              │
 * │  ─────────────────────────                                              │
 * │  - Sin CSRF token (HubSpot usa Bearer Token simple)                     │
 * │  - Sin ETag / If-Match (HubSpot no requiere optimistic locking)         │
 * │  - PATCH devuelve 200 con el objeto completo (SAP devuelve 204 vacío)   │
 * │  - El rate limit es el problema principal (SAP no tiene rate limit)      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { env } from '../../config/env';

// ---------------------------------------------------------------------------
// Configuración de retry
// ---------------------------------------------------------------------------

/** Número máximo de reintentos ante 429 Too Many Requests */
const MAX_RETRIES = 3;

/** Espera por defecto si el header Retry-After no está presente (en ms) */
const DEFAULT_RETRY_DELAY_MS = 1_000;

/**
 * Espera N milisegundos.
 * Usada para respetar el header Retry-After de HubSpot.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extrae el tiempo de espera del header Retry-After.
 * HubSpot envía el valor en segundos (ej: "2").
 * Si no existe o no es parseable, retorna el default.
 */
function getRetryDelayMs(retryAfterHeader: string | undefined): number {
  if (!retryAfterHeader) return DEFAULT_RETRY_DELAY_MS;
  const seconds = parseInt(retryAfterHeader, 10);
  if (isNaN(seconds) || seconds <= 0) return DEFAULT_RETRY_DELAY_MS;
  return seconds * 1_000;
}

// ---------------------------------------------------------------------------
// Instancia Axios base
// ---------------------------------------------------------------------------

/**
 * Crea la instancia Axios con:
 * - Bearer Token permanente (HUBSPOT_ACCESS_TOKEN)
 * - Headers JSON estándar
 * - Timeout de 15 segundos (HubSpot es más rápido que SAP)
 */
function createAxiosInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL: 'https://api.hubapi.com',
    timeout: 15_000,
    headers: {
      'Authorization': `Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  // --- Interceptor RESPONSE: retry automático en 429 ---
  instance.interceptors.response.use(
    // Respuestas exitosas pasan sin cambios
    (response: AxiosResponse) => response,

    // En error, verificar si es 429 y si quedan reintentos
    async (error) => {
      const config = error.config as AxiosRequestConfig & { _retryCount?: number };

      if (!config || error.response?.status !== 429) {
        return Promise.reject(error);
      }

      // Inicializar o incrementar contador de reintentos
      config._retryCount = (config._retryCount ?? 0) + 1;

      if (config._retryCount > MAX_RETRIES) {
        // Agotados los reintentos: propagar el error 429
        return Promise.reject(error);
      }

      // Leer Retry-After y esperar antes de reintentar
      const retryAfter = error.response.headers['retry-after'] as string | undefined;
      const delayMs = getRetryDelayMs(retryAfter);

      console.warn(
        `[hubspot.client] 429 Too Many Requests. ` +
        `Reintento ${config._retryCount}/${MAX_RETRIES} en ${delayMs}ms...`,
      );

      await sleep(delayMs);

      // Reintentar el request original
      return instance.request(config);
    },
  );

  return instance;
}

// ---------------------------------------------------------------------------
// Cliente HubSpot — métodos públicos
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
 * Cliente HubSpot singleton.
 *
 * Endpoints principales de la API CRM v3:
 *   - /crm/v3/objects/contacts      → Contacts
 *   - /crm/v3/objects/companies     → Companies
 *   - /crm/v3/objects/deals         → Deals
 *
 * Ejemplo de uso:
 *   // Leer un Contact
 *   const res = await hubspotClient.get<HubSpotContact>(
 *     '/crm/v3/objects/contacts/210581802294',
 *     { params: { properties: 'firstname,lastname,email' } }
 *   );
 *
 *   // Actualizar un Contact (devuelve 200 con objeto completo)
 *   const updated = await hubspotClient.patch<HubSpotContact>(
 *     '/crm/v3/objects/contacts/210581802294',
 *     { properties: { firstname: 'Juan' } }
 *   );
 *
 *   // Crear un Deal
 *   const deal = await hubspotClient.post<HubSpotDeal>(
 *     '/crm/v3/objects/deals',
 *     { properties: { dealname: 'Nuevo deal', pipeline: '132611721' } }
 *   );
 */
export const hubspotClient = {
  /**
   * GET — leer un recurso de HubSpot.
   * Soporta query params: properties, associations, etc.
   */
  async get<T = unknown>(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getInstance().get<T>(path, config);
  },

  /**
   * POST — crear un recurso en HubSpot.
   * Devuelve 201 con el objeto creado completo.
   */
  async post<T = unknown>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getInstance().post<T>(path, data, config);
  },

  /**
   * PATCH — actualizar un recurso en HubSpot.
   * Devuelve 200 con el objeto actualizado completo (a diferencia de SAP que devuelve 204).
   * No requiere ETag ni If-Match.
   */
  async patch<T = unknown>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getInstance().patch<T>(path, data, config);
  },

  /**
   * PUT — usado para crear asociaciones entre objetos CRM.
   * Ej: PUT /crm/v3/objects/deals/{dealId}/associations/company/{companyId}/deal_to_company
   */
  async put<T = unknown>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return getInstance().put<T>(path, data, config);
  },

  /**
   * DELETE — archivar un recurso en HubSpot.
   * Devuelve 204 sin body.
   */
  async delete(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return getInstance().delete(path, config);
  },

  // --- Utilidades para testing ---

  /** Resetea la instancia Axios (útil en tests para aislar estado) */
  _resetInstance(): void {
    axiosInstance = null;
  },
};
