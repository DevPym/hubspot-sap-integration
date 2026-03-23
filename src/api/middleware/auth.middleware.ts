/**
 * auth.middleware.ts — Middleware de verificación de firma HMAC-SHA256 para
 * webhooks entrantes de HubSpot.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Verificar que el webhook realmente proviene de HubSpot              │
 * │     (no de un atacante simulando requests)                              │
 * │  2. Validar la firma HMAC-SHA256 (Signature v3) usando                  │
 * │     HUBSPOT_CLIENT_SECRET como clave                                    │
 * │  3. Protección anti-replay: rechazar requests con timestamp             │
 * │     mayor a 5 minutos de antigüedad                                     │
 * │  4. Comparación segura con timingSafeEqual (resistente a timing attacks)│
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Lee de:                                                                │
 * │    - src/config/env.ts → HUBSPOT_CLIENT_SECRET                          │
 * │                                                                         │
 * │  Usado por:                                                             │
 * │    - src/api/routes/hubspot.routes.ts (Fase 7)                          │
 * │      → se registra como middleware en POST /webhooks/hubspot            │
 * │    - src/index.ts (Fase 7)                                              │
 * │      → necesita express.raw() ANTES de express.json() en esa ruta       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLUJO DE VERIFICACIÓN (Signature v3)                                   │
 * │  ────────────────────────────────────                                   │
 * │                                                                         │
 * │  HubSpot construye:                                                     │
 * │    sourceString = METHOD + URL + BODY + TIMESTAMP                       │
 * │    Ej: "POSThttps://app.railway.app/webhooks/hubspot[{...}]170000000"   │
 * │                                                                         │
 * │  HubSpot calcula:                                                       │
 * │    firma = Base64( HMAC-SHA256(sourceString, CLIENT_SECRET) )            │
 * │                                                                         │
 * │  HubSpot envía headers:                                                 │
 * │    X-HubSpot-Signature-v3: <firma>                                      │
 * │    X-HubSpot-Request-Timestamp: <epoch_ms>                              │
 * │                                                                         │
 * │  Nuestro middleware:                                                     │
 * │    1. Extrae timestamp → verifica que no sea > 5 min (anti-replay)      │
 * │    2. Reconstruye sourceString con los mismos componentes                │
 * │    3. Calcula HMAC-SHA256 con nuestro CLIENT_SECRET                     │
 * │    4. Compara firmas con timingSafeEqual                                │
 * │    5. Si coincide → next(). Si no → 401 Unauthorized                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  REQUISITO EN index.ts (Fase 7)                                         │
 * │  ─────────────────────────────                                          │
 * │  El body del webhook DEBE leerse como raw bytes (Buffer), no como       │
 * │  JSON parseado. Si Express parsea primero, la firma no coincide.        │
 * │                                                                         │
 * │  En index.ts:                                                           │
 * │    app.use('/webhooks/hubspot',                                         │
 * │      express.raw({ type: 'application/json' }));                        │
 * │    app.use(express.json()); // DESPUÉS, para el resto de rutas          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../../config/env';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Ventana máxima de tiempo para considerar un request válido (5 minutos) */
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware Express que verifica la firma HMAC-SHA256 v3 de HubSpot.
 *
 * Uso en rutas:
 *   router.post('/webhooks/hubspot', verifyHubSpotSignature, handler);
 *
 * Rechaza con 401 si:
 *   - Falta el header X-HubSpot-Signature-v3 o X-HubSpot-Request-Timestamp
 *   - El timestamp tiene más de 5 minutos de antigüedad (anti-replay)
 *   - La firma HMAC no coincide
 *
 * IMPORTANTE: el body debe llegar como Buffer (express.raw), no como
 * objeto JSON parseado. Si llega parseado, la firma no coincidirá.
 */
export function verifyHubSpotSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const signatureHeader = req.headers['x-hubspot-signature-v3'] as string | undefined;
  const timestampHeader = req.headers['x-hubspot-request-timestamp'] as string | undefined;

  // --- Validar presencia de headers obligatorios ---
  if (!signatureHeader || !timestampHeader) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Faltan headers de firma HubSpot (X-HubSpot-Signature-v3, X-HubSpot-Request-Timestamp)',
    });
    return;
  }

  // --- Validar antigüedad del timestamp (anti-replay) ---
  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'X-HubSpot-Request-Timestamp no es un número válido',
    });
    return;
  }

  const age = Date.now() - timestamp;
  if (age > MAX_TIMESTAMP_AGE_MS) {
    res.status(401).json({
      error: 'Unauthorized',
      message: `Request expirado: tiene ${Math.round(age / 1000)}s de antigüedad (máximo ${MAX_TIMESTAMP_AGE_MS / 1000}s)`,
    });
    return;
  }

  // --- Construir el source string para la firma v3 ---
  // Formato: METHOD + URL completa + BODY (raw) + TIMESTAMP
  const method = req.method;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  // El body debe ser Buffer (express.raw) o string; si es objeto, convertir a string
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body);

  const sourceString = `${method}${url}${rawBody}${timestampHeader}`;

  // --- Calcular HMAC-SHA256 y codificar en Base64 ---
  const computedHash = crypto
    .createHmac('sha256', env.HUBSPOT_CLIENT_SECRET)
    .update(sourceString, 'utf8')
    .digest('base64');

  // --- Comparar firmas de forma segura (timing-safe) ---
  const expected = Buffer.from(signatureHeader, 'utf8');
  const computed = Buffer.from(computedHash, 'utf8');

  // timingSafeEqual requiere buffers del mismo tamaño
  if (expected.length !== computed.length) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Firma HMAC-SHA256 inválida',
    });
    return;
  }

  const isValid = crypto.timingSafeEqual(expected, computed);

  if (!isValid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Firma HMAC-SHA256 inválida',
    });
    return;
  }

  // --- Firma válida, continuar al siguiente handler ---
  next();
}
