/**
 * Tests para src/types/webhook.schemas.ts
 */
import { describe, it, expect } from 'vitest';
import {
  webhookEventSchema,
  webhookPayloadSchema,
  subscriptionTypeSchema,
  isContactEvent,
  isCompanyEvent,
  isDealEvent,
  isCreationEvent,
  isDeletionEvent,
  isPropertyChangeEvent,
  isAssociationChangeEvent,
  type WebhookEvent,
} from '../src/types/webhook.schemas';

// ---------------------------------------------------------------------------
// Evento base válido para reutilizar en tests
// ---------------------------------------------------------------------------

const validEvent: WebhookEvent = {
  eventId: 1001,
  subscriptionId: 200,
  portalId: 123456,
  appId: 9999,
  occurredAt: 1700000000000,
  subscriptionType: 'contact.propertyChange',
  attemptNumber: 0,
  objectId: 210581802294,
  propertyName: 'firstname',
  propertyValue: 'Juan',
};

// ---------------------------------------------------------------------------
// Tests de subscriptionTypeSchema
// ---------------------------------------------------------------------------

describe('subscriptionTypeSchema', () => {
  it('acepta todos los tipos de suscripción soportados', () => {
    const validTypes = [
      'contact.creation',
      'contact.deletion',
      'contact.propertyChange',
      'company.creation',
      'company.deletion',
      'company.propertyChange',
      'deal.creation',
      'deal.deletion',
      'deal.propertyChange',
      'deal.associationChange',
    ];
    for (const type of validTypes) {
      const result = subscriptionTypeSchema.safeParse(type);
      expect(result.success, `Debería aceptar: ${type}`).toBe(true);
    }
  });

  it('rechaza tipos no soportados', () => {
    const result = subscriptionTypeSchema.safeParse('lead.creation');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests de webhookEventSchema
// ---------------------------------------------------------------------------

describe('webhookEventSchema', () => {
  it('valida un evento propertyChange completo', () => {
    const result = webhookEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('acepta evento de creación sin propertyName ni propertyValue', () => {
    const creationEvent = {
      eventId: 1002,
      subscriptionId: 200,
      portalId: 123456,
      appId: 9999,
      occurredAt: 1700000000000,
      subscriptionType: 'company.creation',
      attemptNumber: 0,
      objectId: 53147869965,
    };
    const result = webhookEventSchema.safeParse(creationEvent);
    expect(result.success).toBe(true);
  });

  it('rechaza occurredAt como string (debe ser number)', () => {
    const result = webhookEventSchema.safeParse({
      ...validEvent,
      occurredAt: '1700000000000',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza objectId como string (debe ser number en el webhook)', () => {
    const result = webhookEventSchema.safeParse({
      ...validEvent,
      objectId: '210581802294',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un subscriptionType inválido', () => {
    const result = webhookEventSchema.safeParse({
      ...validEvent,
      subscriptionType: 'quote.creation',
    });
    expect(result.success).toBe(false);
  });

  it('falla si faltan campos obligatorios', () => {
    const result = webhookEventSchema.safeParse({ eventId: 1 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests de webhookPayloadSchema (array de eventos)
// ---------------------------------------------------------------------------

describe('webhookPayloadSchema', () => {
  it('valida un array con un solo evento', () => {
    const result = webhookPayloadSchema.safeParse([validEvent]);
    expect(result.success).toBe(true);
  });

  it('valida un array con múltiples eventos', () => {
    const result = webhookPayloadSchema.safeParse([
      validEvent,
      { ...validEvent, eventId: 1002, subscriptionType: 'deal.creation' },
    ]);
    expect(result.success).toBe(true);
  });

  it('rechaza un array vacío (min 1 evento requerido)', () => {
    const result = webhookPayloadSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('rechaza un objeto en lugar de array', () => {
    const result = webhookPayloadSchema.safeParse(validEvent);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests de helpers de narrowing
// ---------------------------------------------------------------------------

describe('helpers de tipo', () => {
  it('isContactEvent identifica eventos de Contact', () => {
    expect(isContactEvent({ ...validEvent, subscriptionType: 'contact.creation' })).toBe(true);
    expect(isContactEvent({ ...validEvent, subscriptionType: 'contact.propertyChange' })).toBe(
      true,
    );
    expect(isContactEvent({ ...validEvent, subscriptionType: 'company.creation' })).toBe(false);
    expect(isContactEvent({ ...validEvent, subscriptionType: 'deal.creation' })).toBe(false);
  });

  it('isCompanyEvent identifica eventos de Company', () => {
    expect(isCompanyEvent({ ...validEvent, subscriptionType: 'company.creation' })).toBe(true);
    expect(isCompanyEvent({ ...validEvent, subscriptionType: 'contact.creation' })).toBe(false);
  });

  it('isDealEvent identifica eventos de Deal', () => {
    expect(isDealEvent({ ...validEvent, subscriptionType: 'deal.propertyChange' })).toBe(true);
    expect(isDealEvent({ ...validEvent, subscriptionType: 'deal.associationChange' })).toBe(true);
    expect(isDealEvent({ ...validEvent, subscriptionType: 'contact.creation' })).toBe(false);
  });

  it('isCreationEvent identifica eventos de creación', () => {
    expect(isCreationEvent({ ...validEvent, subscriptionType: 'contact.creation' })).toBe(true);
    expect(isCreationEvent({ ...validEvent, subscriptionType: 'contact.propertyChange' })).toBe(
      false,
    );
  });

  it('isDeletionEvent identifica eventos de eliminación', () => {
    expect(isDeletionEvent({ ...validEvent, subscriptionType: 'deal.deletion' })).toBe(true);
    expect(isDeletionEvent({ ...validEvent, subscriptionType: 'deal.creation' })).toBe(false);
  });

  it('isPropertyChangeEvent identifica eventos de cambio de propiedad', () => {
    expect(
      isPropertyChangeEvent({ ...validEvent, subscriptionType: 'company.propertyChange' }),
    ).toBe(true);
    expect(isPropertyChangeEvent({ ...validEvent, subscriptionType: 'company.creation' })).toBe(
      false,
    );
  });

  it('isAssociationChangeEvent identifica eventos de asociación', () => {
    expect(
      isAssociationChangeEvent({ ...validEvent, subscriptionType: 'deal.associationChange' }),
    ).toBe(true);
    expect(isAssociationChangeEvent({ ...validEvent, subscriptionType: 'deal.creation' })).toBe(
      false,
    );
  });
});
