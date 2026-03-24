/**
 * webhook.schemas.ts — Schemas Zod para validar payloads de webhooks HubSpot.
 *
 * HubSpot envía los webhooks como un ARRAY de eventos (no objeto individual).
 * Cada request puede contener 1 o más eventos agrupados.
 *
 * Referencia oficial: https://developers.hubspot.com/docs/api/webhooks
 *
 * Campos clave:
 *   occurredAt   — epoch en milisegundos (number, no string). Usado para LWW.
 *   objectId     — ID HubSpot del objeto afectado (number en webhook, string en API REST).
 *   propertyName — solo en eventos 'propertyChange'
 *   propertyValue— solo en eventos 'propertyChange'
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tipos de suscripción soportados (v1 — Contact, Company, Deal)
// ---------------------------------------------------------------------------

export const subscriptionTypeSchema = z.enum([
  // Contactos
  'contact.creation',
  'contact.deletion',
  'contact.propertyChange',
  // Empresas
  'company.creation',
  'company.deletion',
  'company.propertyChange',
  // Deals
  'deal.creation',
  'deal.deletion',
  'deal.propertyChange',
  'deal.associationChange',
  // Genéricos (HubSpot envía estos para suscripciones tipo object.*)
  'object.creation',
  'object.deletion',
  'object.merge',
  'object.restore',
  'object.associationChange',
]);

export type SubscriptionType = z.infer<typeof subscriptionTypeSchema>;

// ---------------------------------------------------------------------------
// Schema de un evento individual dentro del array del webhook
// ---------------------------------------------------------------------------

export const webhookEventSchema = z.object({
  /** ID único del evento (deduplicación) */
  eventId: z.number().int(),
  /** ID de la suscripción de webhook configurada */
  subscriptionId: z.number().int(),
  /** HubSpot Portal ID */
  portalId: z.number().int(),
  /** ID de la app privada */
  appId: z.number().int(),
  /**
   * Timestamp de cuándo ocurrió el evento (epoch ms).
   * Tipo number — usado para Last-Write-Wins (no convertir a string).
   */
  occurredAt: z.number().int(),
  subscriptionType: subscriptionTypeSchema,
  /** Número de intento de entrega (0 = primer intento) */
  attemptNumber: z.number().int(),
  /**
   * ID del objeto HubSpot afectado (Contact, Company, Deal).
   * Llega como number en el webhook — convertir a string al usar la API REST.
   * ⚠️ Opcional: eventos object.associationChange NO envían objectId,
   * usan fromObjectId/toObjectId en su lugar.
   */
  objectId: z.number().int().optional(),
  /** Sistema que originó el cambio (ej: 'CRM', 'INTEGRATION') */
  changeSource: z.string().optional(),
  /** Nombre de la propiedad modificada — solo en eventos 'propertyChange' */
  propertyName: z.string().optional(),
  /** Nuevo valor de la propiedad — solo en eventos 'propertyChange' */
  propertyValue: z.string().optional(),
  /** Flag del cambio — solo en eventos 'associationChange' */
  changeFlag: z.string().optional(),
  /** ID del objeto origen de la asociación — solo en 'associationChange' */
  fromObjectId: z.number().int().optional(),
  /** ID del objeto destino de la asociación — solo en 'associationChange' */
  toObjectId: z.number().int().optional(),
  /**
   * Tipo de objeto — presente en eventos 'object.*' genéricos.
   * HubSpot usa: "0-1"=Contact, "0-2"=Company, "0-3"=Deal
   */
  objectTypeId: z.string().optional(),
  // --- Campos extra en eventos object.associationChange ---
  associationType: z.string().optional(),
  associationCategory: z.string().optional(),
  associationTypeId: z.number().int().optional(),
  fromObjectTypeId: z.string().optional(),
  toObjectTypeId: z.string().optional(),
  associationRemoved: z.boolean().optional(),
  isPrimaryAssociation: z.boolean().optional(),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

// ---------------------------------------------------------------------------
// Schema del payload completo (array de eventos)
// ---------------------------------------------------------------------------

/**
 * HubSpot envía un array de 1 o más eventos por request.
 * `.min(1)` rechaza arrays vacíos que no deberían llegar.
 */
export const webhookPayloadSchema = z.array(webhookEventSchema).min(1);

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

// ---------------------------------------------------------------------------
// Helpers de narrowing por tipo de entidad y operación
// ---------------------------------------------------------------------------

/**
 * El evento corresponde a un Contact.
 * Soporta tanto 'contact.propertyChange' como 'object.creation' con objectTypeId='0-1'.
 */
export const isContactEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.startsWith('contact.') || e.objectTypeId === '0-1';

/**
 * El evento corresponde a una Company.
 * Soporta tanto 'company.propertyChange' como 'object.creation' con objectTypeId='0-2'.
 */
export const isCompanyEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.startsWith('company.') || e.objectTypeId === '0-2';

/**
 * El evento corresponde a un Deal.
 * Soporta tanto 'deal.propertyChange' como 'object.creation' con objectTypeId='0-3'.
 */
export const isDealEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.startsWith('deal.') || e.objectTypeId === '0-3';

/** El evento es de creación de objeto */
export const isCreationEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.endsWith('.creation');

/** El evento es de eliminación de objeto */
export const isDeletionEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.endsWith('.deletion');

/** El evento es de merge — ignorar en v1 */
export const isMergeEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.endsWith('.merge');

/** El evento es de restore — ignorar en v1 */
export const isRestoreEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.endsWith('.restore');

/** El evento es de cambio de propiedad */
export const isPropertyChangeEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.endsWith('.propertyChange');

/** El evento es de cambio de asociación */
export const isAssociationChangeEvent = (e: WebhookEvent): boolean =>
  e.subscriptionType.endsWith('.associationChange');
