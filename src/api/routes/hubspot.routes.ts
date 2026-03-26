/**
 * hubspot.routes.ts — Rutas para recibir webhooks de HubSpot.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. POST /webhooks/hubspot — recibir eventos de HubSpot               │
 * │  2. Validar firma HMAC con auth.middleware                             │
 * │  3. Parsear payload con webhookPayloadSchema (Zod)                    │
 * │  4. Clasificar eventos por tipo de entidad                             │
 * │  5. Encolar cada evento en syncQueue (BullMQ)                          │
 * │  6. Responder 200 inmediatamente (procesamiento asíncrono)            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa:                                                                   │
 * │    - auth.middleware.ts → verifyHubSpotSignature (HMAC)                │
 * │    - webhook.schemas.ts → webhookPayloadSchema, helpers               │
 * │    - sync.queue.ts → addSyncJob()                                     │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/index.ts → app.use('/webhooks', hubspotRoutes)               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLUJO                                                                  │
 * │  ─────                                                                  │
 * │  HubSpot POST → express.raw() → verifyHubSpotSignature → parse JSON  │
 * │    → validate Zod → classify events → addSyncJob() each → 200 OK     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * IMPORTANTE: La ruta necesita express.raw() para que auth.middleware pueda
 * verificar la firma HMAC sobre el body crudo (Buffer). Luego se parsea
 * manualmente con JSON.parse().
 */

import { Router, type Request, type Response } from 'express';
import { verifyHubSpotSignature } from '../middleware/auth.middleware';
import {
  webhookPayloadSchema,
  type WebhookEvent,
  isContactEvent,
  isCompanyEvent,
  isDealEvent,
  isDeletionEvent,
  isMergeEvent,
  isRestoreEvent,
  isAssociationChangeEvent,
} from '../../types/webhook.schemas';
import { addSyncJob } from '../../queue/sync.queue';
import type { EntityType } from '../../generated/prisma/client';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * Determina el EntityType de un evento de webhook.
 * Retorna null si el evento no corresponde a una entidad soportada.
 */
function getEntityType(event: WebhookEvent): EntityType | null {
  if (isContactEvent(event)) return 'CONTACT';
  if (isCompanyEvent(event)) return 'COMPANY';
  if (isDealEvent(event)) return 'DEAL';
  return null;
}

// ---------------------------------------------------------------------------
// Constantes de ObjectTypeId de HubSpot
// ---------------------------------------------------------------------------

/** HubSpot Object Type IDs: "0-1"=Contact, "0-2"=Company, "0-3"=Deal */
const HS_OBJECT_TYPE = {
  CONTACT: '0-1',
  COMPANY: '0-2',
  DEAL: '0-3',
} as const;

/**
 * Extrae el Deal ID de un evento associationChange Deal↔Company.
 *
 * Los eventos associationChange tienen fromObjectId/toObjectId con
 * fromObjectTypeId/toObjectTypeId indicando qué tipo de objeto es cada uno.
 * Esta función verifica que la asociación sea Deal↔Company y retorna el Deal ID.
 *
 * @returns El Deal HubSpot ID (number) o null si no es una asociación Deal↔Company
 */
function getDealIdFromAssociation(event: WebhookEvent): number | null {
  const { fromObjectTypeId, toObjectTypeId, fromObjectId, toObjectId } = event;

  // Deal → Company: fromObjectId es el Deal
  if (fromObjectTypeId === HS_OBJECT_TYPE.DEAL && toObjectTypeId === HS_OBJECT_TYPE.COMPANY) {
    return fromObjectId ?? null;
  }

  // Company → Deal: toObjectId es el Deal
  if (fromObjectTypeId === HS_OBJECT_TYPE.COMPANY && toObjectTypeId === HS_OBJECT_TYPE.DEAL) {
    return toObjectId ?? null;
  }

  return null;
}

/**
 * POST /webhooks/hubspot
 *
 * Recibe un array de eventos de HubSpot, valida la firma HMAC,
 * clasifica cada evento y lo encola para procesamiento asíncrono.
 *
 * HubSpot espera una respuesta 200 dentro de 5 segundos.
 * El procesamiento real ocurre en el worker (sync.worker.ts).
 */
router.post(
  '/hubspot',
  // Middleware HMAC: valida que el request viene de HubSpot
  verifyHubSpotSignature,
  async (req: Request, res: Response) => {
    try {
      // El body llega como Buffer (por express.raw()).
      // Lo parseamos manualmente a JSON.
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : req.body;
      const jsonBody = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

      // Validar estructura con Zod
      const parseResult = webhookPayloadSchema.safeParse(jsonBody);

      if (!parseResult.success) {
        // Log del payload crudo para diagnosticar qué envía HubSpot
        console.warn('[webhook] Payload crudo recibido:', JSON.stringify(jsonBody).substring(0, 500));
        console.warn('[webhook] Payload inválido:', parseResult.error.flatten());
        // Responder 200 para que HubSpot deje de reintentar payloads incompatibles
        res.status(200).json({
          error: 'Invalid webhook payload',
          details: parseResult.error.flatten().fieldErrors,
        });
        return;
      }

      const events = parseResult.data;
      let enqueued = 0;
      let skipped = 0;

      for (const event of events) {
        // Ignorar deletions, merges y restores (v1 no los sincroniza)
        if (isDeletionEvent(event) || isMergeEvent(event) || isRestoreEvent(event)) {
          console.log(`[webhook] ⏭️ Saltado: ${event.subscriptionType} (objectId=${event.objectId || event.fromObjectId})`);
          skipped++;
          continue;
        }

        const entityType = getEntityType(event);
        if (!entityType) {
          console.log(`[webhook] ⏭️ Saltado: ${event.subscriptionType} (entidad no soportada, objectTypeId=${event.objectTypeId})`);
          skipped++;
          continue;
        }

        // ─────────────────────────────────────────────────────────────
        // Fix A1: Procesar eventos associationChange (Deal↔Company)
        // Estos eventos NO tienen objectId, pero sí fromObjectId/toObjectId.
        // Si es una asociación Deal↔Company, encolamos sync del Deal para
        // que resolveCompanyForDeal() recoja la nueva Company asociada.
        // ─────────────────────────────────────────────────────────────
        if (isAssociationChangeEvent(event)) {
          // Ignorar eliminaciones de asociación en v1
          if (event.associationRemoved) {
            console.log(`[webhook] ⏭️ Saltado: ${event.subscriptionType} (asociación eliminada, from=${event.fromObjectId} to=${event.toObjectId})`);
            skipped++;
            continue;
          }

          const dealObjectId = getDealIdFromAssociation(event);
          if (dealObjectId) {
            await addSyncJob({
              objectId: String(dealObjectId),
              entityType: 'DEAL',
              occurredAt: event.occurredAt,
              subscriptionType: event.subscriptionType,
            });
            console.log(`[webhook] 🔗 AssociationChange Deal↔Company: encolado Deal ${dealObjectId}`);
            enqueued++;
          } else {
            console.log(`[webhook] ⏭️ Saltado: ${event.subscriptionType} (asociación no es Deal↔Company, from=${event.fromObjectTypeId} to=${event.toObjectTypeId})`);
            skipped++;
          }
          continue;
        }

        // objectId puede ser undefined en otros eventos no soportados
        if (!event.objectId) {
          console.log(`[webhook] ⏭️ Saltado: ${event.subscriptionType} (sin objectId, from=${event.fromObjectId} to=${event.toObjectId})`);
          skipped++;
          continue;
        }

        // Encolar para procesamiento asíncrono
        await addSyncJob({
          objectId: String(event.objectId),
          entityType,
          occurredAt: event.occurredAt,
          subscriptionType: event.subscriptionType,
        });
        enqueued++;
      }

      console.log(
        `[webhook] Recibidos ${events.length} eventos: ${enqueued} encolados, ${skipped} saltados`,
      );

      // Responder 200 inmediatamente — HubSpot espera respuesta rápida
      res.status(200).json({
        received: events.length,
        enqueued,
        skipped,
      });
    } catch (error) {
      console.error('[webhook] Error procesando webhook:', error);
      // Responder 200 incluso en error para que HubSpot no reintente
      // (el error se loguea para debugging)
      res.status(200).json({ received: 0, error: 'Internal processing error' });
    }
  },
);

export default router;
