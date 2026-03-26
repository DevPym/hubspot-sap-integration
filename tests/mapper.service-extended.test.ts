/**
 * Tests extendidos para mapper.service.ts — Funciones faltantes.
 *
 * Cubre:
 * - normalizeCountryCode(): nombre→ISO, código→ISO, default, desconocido
 * - normalizeRegionCode(): regiones Chile, país no-CL, desconocida
 * - paymentTermsToSap(): texto→código, código directo, desconocido
 * - paymentTermsToHubSpot(): código→texto, desconocido
 * - cleanNulls(): null, undefined, strings vacíos, arrays, nested
 * - normalizeRut(): con puntos, sin puntos, vacío
 * - extractAddressPayload(): campos parciales, vacío
 * - extractEmailPayload(): con/sin email
 * - extractPhonePayload(): con/sin phone, separación código país
 * - extractMobilePayload(): con/sin mobile
 * - sapBPToContactUpdate(): edge cases (phone, mobile, address, company)
 * - sapBPToCompanyUpdate(): paymentTerms inverso, RUT, foundedYear
 * - salesOrderToDealUpdate(): moneda, cantidad ítems, paymentTerms inverso
 */

import { describe, it, expect, vi } from 'vitest';
import {
  normalizeCountryCode,
  normalizeRegionCode,
  paymentTermsToSap,
  paymentTermsToHubSpot,
  cleanNulls,
  normalizeRut,
  extractAddressPayload,
  extractEmailPayload,
  extractPhonePayload,
  extractMobilePayload,
  sapBPToContactUpdate,
  sapBPToCompanyUpdate,
  salesOrderToDealUpdate,
} from '../src/services/mapper.service';

import type { SapBusinessPartner, SapBPAddress, SapSalesOrder } from '../src/adapters/sap/sap.types';

// ===========================================================================
// normalizeCountryCode
// ===========================================================================

describe('normalizeCountryCode', () => {
  it('retorna CL por defecto si input es undefined', () => {
    expect(normalizeCountryCode(undefined)).toBe('CL');
  });

  it('retorna CL por defecto si input es string vacío', () => {
    expect(normalizeCountryCode('')).toBe('CL');
    expect(normalizeCountryCode('   ')).toBe('CL');
  });

  it('convierte nombre "Chile" a "CL"', () => {
    expect(normalizeCountryCode('Chile')).toBe('CL');
    expect(normalizeCountryCode('chile')).toBe('CL');
    expect(normalizeCountryCode('CHILE')).toBe('CL');
  });

  it('convierte nombres de otros países latinoamericanos', () => {
    expect(normalizeCountryCode('Argentina')).toBe('AR');
    expect(normalizeCountryCode('Peru')).toBe('PE');
    expect(normalizeCountryCode('Perú')).toBe('PE');
    expect(normalizeCountryCode('Colombia')).toBe('CO');
    expect(normalizeCountryCode('Brasil')).toBe('BR');
    expect(normalizeCountryCode('Brazil')).toBe('BR');
    expect(normalizeCountryCode('México')).toBe('MX');
    expect(normalizeCountryCode('Mexico')).toBe('MX');
  });

  it('pasa código ISO 2 letras directo (ya normalizado)', () => {
    expect(normalizeCountryCode('CL')).toBe('CL');
    expect(normalizeCountryCode('cl')).toBe('CL');
    expect(normalizeCountryCode('AR')).toBe('AR');
    expect(normalizeCountryCode('us')).toBe('US');
  });

  it('convierte USA y España', () => {
    expect(normalizeCountryCode('United States')).toBe('US');
    expect(normalizeCountryCode('Estados Unidos')).toBe('US');
    expect(normalizeCountryCode('USA')).toBe('US');
    expect(normalizeCountryCode('España')).toBe('ES');
    expect(normalizeCountryCode('Spain')).toBe('ES');
  });

  it('retorna CL para país no reconocido con warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeCountryCode('Wakanda')).toBe('CL');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('País no reconocido'));
    warnSpy.mockRestore();
  });

  it('maneja espacios al inicio/final', () => {
    expect(normalizeCountryCode('  Chile  ')).toBe('CL');
  });
});

// ===========================================================================
// normalizeRegionCode
// ===========================================================================

describe('normalizeRegionCode', () => {
  it('retorna undefined para input vacío', () => {
    expect(normalizeRegionCode(undefined)).toBeUndefined();
    expect(normalizeRegionCode('')).toBeUndefined();
    expect(normalizeRegionCode('   ')).toBeUndefined();
  });

  it('convierte regiones chilenas por nombre', () => {
    expect(normalizeRegionCode('Metropolitana')).toBe('RM');
    expect(normalizeRegionCode('Santiago')).toBe('RM');
    expect(normalizeRegionCode('Valparaíso')).toBe('VS');
    expect(normalizeRegionCode('Valparaiso')).toBe('VS');
    expect(normalizeRegionCode('Antofagasta')).toBe('AN');
    expect(normalizeRegionCode('Coquimbo')).toBe('CO');
    expect(normalizeRegionCode('Maule')).toBe('ML');
    expect(normalizeRegionCode('Araucanía')).toBe('AR');
    expect(normalizeRegionCode('Los Lagos')).toBe('LL');
    expect(normalizeRegionCode('Magallanes')).toBe('MA');
  });

  it('convierte regiones por número romano', () => {
    expect(normalizeRegionCode('RM')).toBe('RM');
    expect(normalizeRegionCode('rm')).toBe('RM');
    expect(normalizeRegionCode('V')).toBe('VS');
    expect(normalizeRegionCode('XIII')).toBe('RM');
    expect(normalizeRegionCode('XV')).toBe('AP');
  });

  it('convierte regiones con tildes y sin tildes', () => {
    expect(normalizeRegionCode('Ñuble')).toBe('NB');
    expect(normalizeRegionCode('Aysén')).toBe('AI');
    expect(normalizeRegionCode('Aysen')).toBe('AI');
    expect(normalizeRegionCode("O'Higgins")).toBe('LI');
    expect(normalizeRegionCode('Tarapacá')).toBe('TA');
    expect(normalizeRegionCode('Tarapaca')).toBe('TA');
    expect(normalizeRegionCode('Los Ríos')).toBe('LR');
    expect(normalizeRegionCode('Los Rios')).toBe('LR');
  });

  it('pasa valor tal cual para países que no son Chile', () => {
    expect(normalizeRegionCode('Buenos Aires', 'Argentina')).toBe('Buenos Aires');
    expect(normalizeRegionCode('California', 'United States')).toBe('California');
  });

  it('retorna undefined para región no reconocida en Chile', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeRegionCode('Región Inventada')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Región no reconocida'));
    warnSpy.mockRestore();
  });

  it('asume Chile si no se especifica país', () => {
    expect(normalizeRegionCode('Metropolitana')).toBe('RM');
  });
});

// ===========================================================================
// paymentTermsToSap
// ===========================================================================

describe('paymentTermsToSap', () => {
  it('retorna undefined para input vacío', () => {
    expect(paymentTermsToSap(undefined)).toBeUndefined();
  });

  it('convierte texto HubSpot a código SAP', () => {
    expect(paymentTermsToSap('Pago contado')).toBe('NT00');
    expect(paymentTermsToSap('30 días')).toBe('NT30');
    expect(paymentTermsToSap('30 dias')).toBe('NT30');
    expect(paymentTermsToSap('45 días')).toBe('NT45');
    expect(paymentTermsToSap('60 días')).toBe('NT60');
    expect(paymentTermsToSap('90 días')).toBe('NT90');
  });

  it('acepta código SAP directamente (pass-through)', () => {
    expect(paymentTermsToSap('NT00')).toBe('NT00');
    expect(paymentTermsToSap('NT30')).toBe('NT30');
    expect(paymentTermsToSap('nt60')).toBe('NT60');
  });

  it('es case-insensitive', () => {
    expect(paymentTermsToSap('pago contado')).toBe('NT00');
    expect(paymentTermsToSap('PAGO CONTADO')).toBe('NT00');
    expect(paymentTermsToSap('30 DÍAS')).toBe('NT30');
  });

  it('maneja espacios', () => {
    expect(paymentTermsToSap('  30 días  ')).toBe('NT30');
    expect(paymentTermsToSap('  NT30  ')).toBe('NT30');
  });

  it('retorna undefined para valor no reconocido con warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(paymentTermsToSap('120 días')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Condición de pago no reconocida'));
    warnSpy.mockRestore();
  });
});

// ===========================================================================
// paymentTermsToHubSpot
// ===========================================================================

describe('paymentTermsToHubSpot', () => {
  it('retorna undefined para input vacío', () => {
    expect(paymentTermsToHubSpot(undefined)).toBeUndefined();
  });

  it('convierte código SAP a texto HubSpot', () => {
    expect(paymentTermsToHubSpot('NT00')).toBe('Pago contado');
    expect(paymentTermsToHubSpot('NT30')).toBe('30 días');
    expect(paymentTermsToHubSpot('NT45')).toBe('45 días');
    expect(paymentTermsToHubSpot('NT60')).toBe('60 días');
    expect(paymentTermsToHubSpot('NT90')).toBe('90 días');
  });

  it('es case-insensitive', () => {
    expect(paymentTermsToHubSpot('nt30')).toBe('30 días');
    expect(paymentTermsToHubSpot('Nt60')).toBe('60 días');
  });

  it('retorna undefined para código no reconocido', () => {
    expect(paymentTermsToHubSpot('NT99')).toBeUndefined();
    expect(paymentTermsToHubSpot('INVALID')).toBeUndefined();
  });
});

// ===========================================================================
// cleanNulls
// ===========================================================================

describe('cleanNulls', () => {
  it('retorna null/undefined tal cual', () => {
    expect(cleanNulls(null)).toBeNull();
    expect(cleanNulls(undefined)).toBeUndefined();
  });

  it('no modifica primitivos', () => {
    expect(cleanNulls('hello')).toBe('hello');
    expect(cleanNulls(42)).toBe(42);
    expect(cleanNulls(true)).toBe(true);
  });

  it('elimina propiedades null de objetos', () => {
    expect(cleanNulls({ a: 'ok', b: null, c: 'yes' })).toEqual({ a: 'ok', c: 'yes' });
  });

  it('elimina propiedades undefined de objetos', () => {
    expect(cleanNulls({ a: 'ok', b: undefined })).toEqual({ a: 'ok' });
  });

  it('elimina strings vacíos de objetos', () => {
    expect(cleanNulls({ a: 'ok', b: '' })).toEqual({ a: 'ok' });
  });

  it('limpia recursivamente objetos anidados', () => {
    expect(cleanNulls({
      name: 'Test',
      address: { street: 'Av. Test', city: null, zip: '' },
    })).toEqual({
      name: 'Test',
      address: { street: 'Av. Test' },
    });
  });

  it('limpia arrays', () => {
    expect(cleanNulls([{ a: null, b: 'ok' }, { c: '' }])).toEqual([{ b: 'ok' }, {}]);
  });

  it('mantiene números y booleanos incluyendo 0 y false', () => {
    expect(cleanNulls({ a: 0, b: false, c: null })).toEqual({ a: 0, b: false });
  });
});

// ===========================================================================
// normalizeRut
// ===========================================================================

describe('normalizeRut', () => {
  it('retorna undefined para input vacío', () => {
    expect(normalizeRut(undefined)).toBeUndefined();
  });

  it('quita puntos y mantiene guión', () => {
    expect(normalizeRut('99.404.490-0')).toBe('99404490-0');
    expect(normalizeRut('11.111.111-1')).toBe('11111111-1');
    expect(normalizeRut('76.543.210-K')).toBe('76543210-K');
  });

  it('no modifica RUT ya normalizado', () => {
    expect(normalizeRut('99404490-0')).toBe('99404490-0');
  });

  it('quita solo puntos, no guiones ni letras', () => {
    expect(normalizeRut('1.234.567-8')).toBe('1234567-8');
  });

  it('maneja espacios', () => {
    expect(normalizeRut('  99.404.490-0  ')).toBe('99404490-0');
  });
});

// ===========================================================================
// extractAddressPayload
// ===========================================================================

describe('extractAddressPayload', () => {
  it('extrae todos los campos de dirección', () => {
    const result = extractAddressPayload({
      address: 'Av. Test 123',
      city: 'Santiago',
      zip: '8320000',
      country: 'Chile',
      state: 'Metropolitana',
      comuna: 'Las Condes',
    });

    expect(result.StreetName).toBe('Av. Test 123');
    expect(result.CityName).toBe('Santiago');
    expect(result.PostalCode).toBe('8320000');
    expect(result.Country).toBe('CL');
    expect(result.Region).toBe('RM');
    expect(result.District).toBe('Las Condes');
  });

  it('retorna objeto vacío si no hay campos de dirección', () => {
    const result = extractAddressPayload({ firstname: 'Juan' } as Record<string, unknown>);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('omite campos vacíos', () => {
    const result = extractAddressPayload({
      address: 'Av. Test',
      city: undefined,
      zip: '',
    });

    expect(result.StreetName).toBe('Av. Test');
    expect(result).not.toHaveProperty('CityName');
    expect(result).not.toHaveProperty('PostalCode');
  });

  it('normaliza country a código ISO', () => {
    const result = extractAddressPayload({ country: 'Argentina' });
    expect(result.Country).toBe('AR');
  });

  it('normaliza state a código de región para Chile', () => {
    const result = extractAddressPayload({ state: 'Valparaíso', country: 'Chile' });
    expect(result.Region).toBe('VS');
  });
});

// ===========================================================================
// extractEmailPayload
// ===========================================================================

describe('extractEmailPayload', () => {
  it('retorna payload con OrdinalNumber=1 si hay email', () => {
    const result = extractEmailPayload({ email: 'test@ejemplo.cl' });
    expect(result).toEqual({ OrdinalNumber: '1', EmailAddress: 'test@ejemplo.cl' });
  });

  it('retorna null si no hay email', () => {
    expect(extractEmailPayload({})).toBeNull();
    expect(extractEmailPayload({ email: undefined })).toBeNull();
  });

  it('retorna null para props de Company sin email', () => {
    expect(extractEmailPayload({ name: 'Empresa' } as Record<string, unknown>)).toBeNull();
  });
});

// ===========================================================================
// extractPhonePayload
// ===========================================================================

describe('extractPhonePayload', () => {
  it('retorna payload con número separado del código de país', () => {
    const result = extractPhonePayload({ phone: '+56912345678' });
    expect(result).toEqual({
      OrdinalNumber: '1',
      PhoneNumber: '912345678',
      DestinationLocationCountry: 'CL',
      PhoneNumberType: '1',
    });
  });

  it('retorna null si no hay phone', () => {
    expect(extractPhonePayload({})).toBeNull();
    expect(extractPhonePayload({ phone: undefined })).toBeNull();
  });

  it('maneja número local sin código de país', () => {
    const result = extractPhonePayload({ phone: '912345678' });
    expect(result).not.toBeNull();
    expect(result!.PhoneNumber).toBe('912345678');
    expect(result!.DestinationLocationCountry).toBe('CL');
  });

  it('limpia caracteres especiales del número', () => {
    const result = extractPhonePayload({ phone: '+56 9 1234 5678' });
    expect(result!.PhoneNumber).toBe('912345678');
  });
});

// ===========================================================================
// extractMobilePayload
// ===========================================================================

describe('extractMobilePayload', () => {
  it('retorna payload con PhoneNumberType=3 (móvil)', () => {
    const result = extractMobilePayload({ mobilephone: '+56987654321' });
    expect(result).toEqual({
      OrdinalNumber: '1',
      PhoneNumber: '987654321',
      DestinationLocationCountry: 'CL',
      PhoneNumberType: '3',
    });
  });

  it('retorna null si no hay mobilephone', () => {
    expect(extractMobilePayload({})).toBeNull();
    expect(extractMobilePayload({ mobilephone: undefined })).toBeNull();
  });
});

// ===========================================================================
// sapBPToContactUpdate — edge cases
// ===========================================================================

describe('sapBPToContactUpdate — edge cases', () => {
  const baseBP: SapBusinessPartner = {
    BusinessPartner: '100000031',
    BusinessPartnerCategory: '1',
    FirstName: 'Juan',
    LastName: 'Pérez',
  };

  it('incluye phone, mobile y email cuando están presentes', () => {
    const result = sapBPToContactUpdate(baseBP, undefined, 'juan@test.cl', '+56912345678', '+56987654321');
    expect(result.email).toBe('juan@test.cl');
    expect(result.phone).toBe('+56912345678');
    expect(result.mobilephone).toBe('+56987654321');
  });

  it('omite phone/mobile/email cuando son undefined', () => {
    const result = sapBPToContactUpdate(baseBP);
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
    expect(result).not.toHaveProperty('mobilephone');
  });

  it('incluye NaturalPersonEmployerName como company', () => {
    const bp = { ...baseBP, NaturalPersonEmployerName: 'Empresa Test' };
    const result = sapBPToContactUpdate(bp);
    expect(result.company).toBe('Empresa Test');
  });

  it('incluye todos los campos de address', () => {
    const address: SapBPAddress = {
      AddressID: '1',
      StreetName: 'Av. Providencia 123',
      CityName: 'Santiago',
      PostalCode: '7500000',
      Country: 'CL',
      Region: 'RM',
      District: 'Providencia',
    };
    const result = sapBPToContactUpdate(baseBP, address);
    expect(result.address).toBe('Av. Providencia 123');
    expect(result.city).toBe('Santiago');
    expect(result.zip).toBe('7500000');
    expect(result.country).toBe('CL');
    expect(result.state).toBe('RM');
    expect(result.comuna).toBe('Providencia');
  });

  it('omite campos vacíos del address', () => {
    const address: SapBPAddress = {
      AddressID: '1',
      StreetName: 'Av. Test',
      // Sin city, zip, etc.
    };
    const result = sapBPToContactUpdate(baseBP, address);
    expect(result.address).toBe('Av. Test');
    expect(result).not.toHaveProperty('city');
    expect(result).not.toHaveProperty('zip');
  });

  it('retorna objeto vacío si BP no tiene datos útiles', () => {
    const emptyBP: SapBusinessPartner = {
      BusinessPartner: '100000099',
      BusinessPartnerCategory: '1',
    };
    const result = sapBPToContactUpdate(emptyBP);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ===========================================================================
// sapBPToCompanyUpdate — edge cases
// ===========================================================================

describe('sapBPToCompanyUpdate — edge cases', () => {
  const baseBP: SapBusinessPartner = {
    BusinessPartner: '100000060',
    BusinessPartnerCategory: '2',
    OrganizationBPName1: 'Empresa SAP',
  };

  it('incluye OrganizationBPName2 como description', () => {
    const bp = { ...baseBP, OrganizationBPName2: 'Descripción larga' };
    const result = sapBPToCompanyUpdate(bp);
    expect(result.description).toBe('Descripción larga');
  });

  it('incluye OrganizationBPName3 como razon_social', () => {
    const bp = { ...baseBP, OrganizationBPName3: 'Razón Social Formal' };
    const result = sapBPToCompanyUpdate(bp);
    expect(result.razon_social).toBe('Razón Social Formal');
  });

  it('extrae año de OrganizationFoundationDate', () => {
    const bp = { ...baseBP, OrganizationFoundationDate: '2005-01-01' };
    const result = sapBPToCompanyUpdate(bp);
    expect(result.founded_year).toBe('2005');
  });

  it('incluye RUT y teléfono', () => {
    const result = sapBPToCompanyUpdate(baseBP, undefined, '+56221234567', '99404490-0');
    expect(result.phone).toBe('+56221234567');
    expect(result.rut_empresa).toBe('99404490-0');
  });

  it('incluye campos de address', () => {
    const address: SapBPAddress = {
      AddressID: '1',
      StreetName: 'Av. Industrial 500',
      CityName: 'Valparaíso',
      Country: 'CL',
      Region: 'VS',
    };
    const result = sapBPToCompanyUpdate(baseBP, address);
    expect(result.address).toBe('Av. Industrial 500');
    expect(result.city).toBe('Valparaíso');
    expect(result.country).toBe('CL');
    expect(result.state).toBe('VS');
  });

  it('retorna solo name si BP solo tiene OrganizationBPName1', () => {
    const result = sapBPToCompanyUpdate(baseBP);
    expect(result.name).toBe('Empresa SAP');
    expect(Object.keys(result)).toHaveLength(1);
  });
});

// ===========================================================================
// salesOrderToDealUpdate — edge cases
// ===========================================================================

describe('salesOrderToDealUpdate — edge cases', () => {
  const baseSO: SapSalesOrder = {
    SalesOrder: '50',
    SalesOrderType: 'OR',
    SoldToParty: '100000060',
    PurchaseOrderByCustomer: 'PO-TEST-001',
    TotalNetAmount: '750000',
    TransactionCurrency: 'CLP',
    RequestedDeliveryDate: '/Date(1719705600000)/',
  };

  it('transforma todos los campos correctamente', () => {
    const result = salesOrderToDealUpdate(baseSO);
    expect(result.dealname).toBe('PO-TEST-001');
    expect(result.amount).toBe('750000');
    expect(result.deal_currency_code).toBe('CLP');
    expect(result.orden_de_compra_o_contratoo).toBe('PO-TEST-001');
    // closedate y fecha_de_entrega deben ser YYYY-MM-DD
    expect(result.closedate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.fecha_de_entrega).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('incluye condicion_de_pago si CustomerPaymentTerms existe', () => {
    const so = { ...baseSO, CustomerPaymentTerms: 'NT30' };
    const result = salesOrderToDealUpdate(so);
    expect(result.condicion_de_pago).toBe('30 días');
  });

  it('usa código SAP tal cual si paymentTermsToHubSpot no lo reconoce', () => {
    const so = { ...baseSO, CustomerPaymentTerms: 'ZXXX' };
    const result = salesOrderToDealUpdate(so);
    expect(result.condicion_de_pago).toBe('ZXXX');
  });

  it('incluye cantidad del primer ítem', () => {
    const so = {
      ...baseSO,
      to_Item: { results: [{ SalesOrderItem: '10', RequestedQuantity: '500', Material: 'Q01' } as unknown as import('../src/adapters/sap/sap.types').SapSalesOrderItem] },
    };
    const result = salesOrderToDealUpdate(so);
    expect(result.cuanto_es_la_cantidad_requerida_del_producto_).toBe('500');
  });

  it('no incluye cantidad si no hay ítems', () => {
    const result = salesOrderToDealUpdate(baseSO);
    expect(result).not.toHaveProperty('cuanto_es_la_cantidad_requerida_del_producto_');
  });

  it('no incluye cantidad si ítems están vacíos', () => {
    const so = { ...baseSO, to_Item: { results: [] } };
    const result = salesOrderToDealUpdate(so);
    expect(result).not.toHaveProperty('cuanto_es_la_cantidad_requerida_del_producto_');
  });

  it('retorna objeto vacío si SO no tiene datos sincronizables', () => {
    const emptySO: SapSalesOrder = {
      SalesOrder: '99',
      SalesOrderType: 'OR',
      SoldToParty: '100000060',
    };
    const result = salesOrderToDealUpdate(emptySO);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('maneja moneda USD correctamente', () => {
    const so = { ...baseSO, TransactionCurrency: 'USD' };
    const result = salesOrderToDealUpdate(so);
    expect(result.deal_currency_code).toBe('USD');
  });
});
