/**
 * error.middleware.ts — Manejador centralizado de errores de Express.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Capturar TODOS los errores que ocurran en cualquier ruta/middleware  │
 * │  2. Formatear la respuesta como JSON uniforme (nunca HTML)              │
 * │  3. Distinguir tipos de error para dar mensajes útiles:                 │
 * │     - AxiosError → problemas con SAP o HubSpot (APIs externas)          │
 * │     - ZodError   → payload de webhook inválido (validación fallida)     │
 * │     - Error genérico → errores internos de la aplicación                │
 * │  4. Ocultar detalles internos en producción (seguridad)                 │
 * │  5. Registrar cada error en consola para diagnóstico                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Captura errores de:                                                    │
 * │    - src/adapters/sap/sap.client.ts      → AxiosError (timeout, 403)    │
 * │    - src/adapters/hubspot/hubspot.client.ts → AxiosError (429, 401)     │
 * │    - src/api/middleware/auth.middleware.ts → errores inesperados HMAC    │
 * │    - src/api/routes/hubspot.routes.ts     → ZodError (payload inválido) │
 * │    - src/services/sync.service.ts         → errores de negocio          │
 * │    - src/db/prisma.client.ts              → errores de base de datos    │
 * │                                                                         │
 * │  Registrado en:                                                         │
 * │    - src/index.ts (Fase 7) → app.use(errorHandler) AL FINAL de todo     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FORMATO DE RESPUESTA                                                   │
 * │  ────────────────────                                                   │
 * │                                                                         │
 * │  Desarrollo (NODE_ENV=development):                                     │
 * │  {                                                                      │
 * │    "error": "Bad Gateway",                                              │
 * │    "message": "SAP respondió 500: Internal Server Error",               │
 * │    "statusCode": 502,                                                   │
 * │    "details": { ... detalles del error original ... }                   │
 * │  }                                                                      │
 * │                                                                         │
 * │  Producción (NODE_ENV=production):                                      │
 * │  {                                                                      │
 * │    "error": "Bad Gateway",                                              │
 * │    "message": "Error al comunicarse con servicio externo",              │
 * │    "statusCode": 502                                                    │
 * │  }                                                                      │
 * │  (sin details → no exponer stack traces ni datos internos)              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  REGISTRO EN EXPRESS                                                    │
 * │  ─────────────────                                                      │
 * │  Express identifica middlewares de error por tener 4 parámetros:        │
 * │    (err, req, res, next) — vs. los 3 de un middleware normal.           │
 * │                                                                         │
 * │  Debe registrarse DESPUÉS de todas las rutas en index.ts:               │
 * │    app.use('/webhooks/hubspot', hubspotRoutes);                         │
 * │    app.use(errorHandler); // ← siempre al final                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { Request, Response, NextFunction } from 'express';
import { AxiosError } from 'axios';
import { ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Interfaz de respuesta de error
// ---------------------------------------------------------------------------

interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  /** Solo presente en development — detalles para diagnóstico */
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers para clasificar tipos de error
// ---------------------------------------------------------------------------

/**
 * Construye la respuesta para errores de Axios (SAP o HubSpot no responden,
 * timeout, error HTTP del servidor externo, etc.).
 *
 * Se usa status 502 (Bad Gateway) porque el error proviene de un
 * servicio externo (upstream), no de nuestra aplicación.
 */
function handleAxiosError(err: AxiosError, isDev: boolean): ErrorResponse {
  const status = err.response?.status;
  const externalMessage = err.response?.statusText ?? err.message;
  const url = err.config?.url ?? 'desconocido';

  // Timeout específico
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    return {
      error: 'Gateway Timeout',
      message: isDev
        ? `Timeout al conectar con ${url}`
        : 'Timeout al comunicarse con servicio externo',
      statusCode: 504,
      ...(isDev && {
        details: {
          url,
          code: err.code,
          timeout: err.config?.timeout,
        },
      }),
    };
  }

  return {
    error: 'Bad Gateway',
    message: isDev
      ? `Servicio externo respondió ${status}: ${externalMessage} (${url})`
      : 'Error al comunicarse con servicio externo',
    statusCode: 502,
    ...(isDev && {
      details: {
        url,
        status,
        statusText: err.response?.statusText,
        data: err.response?.data,
      },
    }),
  };
}

/**
 * Construye la respuesta para errores de validación Zod.
 * Se usa status 422 (Unprocessable Entity) porque los datos
 * llegaron pero no cumplen con el schema esperado.
 */
function handleZodError(err: ZodError, isDev: boolean): ErrorResponse {
  const issues = err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));

  return {
    error: 'Unprocessable Entity',
    message: 'Los datos recibidos no cumplen con el formato esperado',
    statusCode: 422,
    ...(isDev && { details: { issues } }),
  };
}

/**
 * Construye la respuesta para errores genéricos (cualquier otro Error).
 * Se usa status 500 (Internal Server Error) como fallback.
 */
function handleGenericError(err: Error, isDev: boolean): ErrorResponse {
  return {
    error: 'Internal Server Error',
    message: isDev ? err.message : 'Error interno del servidor',
    statusCode: 500,
    ...(isDev && {
      details: {
        name: err.name,
        stack: err.stack,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Middleware de error (4 parámetros → Express lo identifica como error handler)
// ---------------------------------------------------------------------------

/**
 * Middleware centralizado de errores.
 *
 * Express llama a este middleware cuando:
 *   - Un middleware/ruta llama next(error)
 *   - Un middleware/ruta async lanza una excepción no capturada
 *
 * Uso en index.ts:
 *   app.use(errorHandler); // siempre al final, después de todas las rutas
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isDev = process.env.NODE_ENV !== 'production';

  // --- Clasificar el error y construir respuesta ---
  let response: ErrorResponse;

  if (err instanceof AxiosError) {
    response = handleAxiosError(err, isDev);
  } else if (err instanceof ZodError) {
    response = handleZodError(err, isDev);
  } else {
    response = handleGenericError(err, isDev);
  }

  // --- Logging en consola (siempre, en todos los entornos) ---
  console.error(
    `[error] ${response.statusCode} ${response.error}: ${response.message}`,
    isDev ? err : '',
  );

  // --- Enviar respuesta JSON ---
  res.status(response.statusCode).json(response);
}
