/**
 * index.ts — Punto de entrada principal de la aplicación.
 *
 * Inicializa:
 * 1. Express con middlewares (JSON parser, error handler)
 * 2. BullMQ worker para procesar webhooks de HubSpot
 * 3. Rutas: /health, /webhooks/hubspot (Fase 7)
 * 4. Graceful shutdown: cierra worker + cola al recibir SIGTERM/SIGINT
 */

import express from 'express';
import { env } from './config/env';
import { errorHandler } from './api/middleware/error.middleware';
import { createSyncWorker, closeSyncWorker } from './queue/sync.worker';
import { closeSyncQueue } from './queue/sync.queue';
import hubspotRoutes from './api/routes/hubspot.routes';

const app = express();

// Railway usa un reverse proxy — Express necesita confiar en él para que
// req.protocol devuelva 'https' (no 'http'). Sin esto, la firma HMAC falla
// porque HubSpot firma con https:// pero nosotros reconstruíamos con http://.
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Middlewares globales
// ---------------------------------------------------------------------------

// IMPORTANTE: express.raw() DEBE ir ANTES de express.json() para /webhooks/hubspot.
// El auth.middleware necesita el body crudo (Buffer) para verificar la firma HMAC.
// Si express.json() parsea primero, el body ya no es Buffer y la firma falla.
app.use('/webhooks', express.raw({ type: 'application/json' }));

// Para todas las demás rutas, parsear JSON normalmente
app.use(express.json());

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

// Health check — usado por Railway para verificar que la app está viva
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook routes — POST /webhooks/hubspot
app.use('/webhooks', hubspotRoutes);

// ---------------------------------------------------------------------------
// Error handler (debe ir DESPUÉS de todas las rutas)
// ---------------------------------------------------------------------------

app.use(errorHandler);

// ---------------------------------------------------------------------------
// Iniciar servidor + worker
// ---------------------------------------------------------------------------

const server = app.listen(env.PORT, () => {
  console.log(`[server] Servidor iniciado en puerto ${env.PORT} (${env.NODE_ENV})`);
});

// Iniciar worker BullMQ (procesa jobs de la cola)
let workerStarted = false;
try {
  createSyncWorker();
  workerStarted = true;
} catch (error) {
  console.error('[server] ⚠️ No se pudo iniciar el worker BullMQ:', error);
  console.error('[server] El servidor seguirá funcionando sin procesar cola.');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string) {
  console.log(`\n[server] ${signal} recibido — cerrando limpiamente...`);

  // 1. Dejar de aceptar conexiones nuevas
  server.close(() => {
    console.log('[server] HTTP server cerrado');
  });

  // 2. Cerrar worker y cola BullMQ
  if (workerStarted) {
    try {
      await closeSyncWorker();
      await closeSyncQueue();
    } catch (error) {
      console.error('[server] Error cerrando BullMQ:', error);
    }
  }

  // 3. Salir
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
