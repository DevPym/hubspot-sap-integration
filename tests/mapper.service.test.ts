/**
 * Tests para mapper.service.ts — Transformaciones de datos HubSpot <-> SAP.
 *
 * Estos tests verifican funciones PURAS (sin APIs ni DB).
 * No se necesitan mocks — son transformaciones directas de entrada/salida.
 */

import { describe, it, expect } from 'vitest';
import {
  truncate,
  parsePhone,
  yearToDate,
  sapDateToISO,
  sapDateTimeToMs,
  sapDateTimeOffsetToMs,
  isoToSapDate,
  contactToSapBP,
  contactToSapBPUpdate,
  companyToSapBP,
  companyToSapBPUpdate,
  dealToSalesOrder,
  dealToSalesOrderUpdate,
  sapBPToContactUpdate,
  sapBPToCompanyUpdate,
  salesOrderToDealUpdate,
  SAP_CONSTANTS,
} from '../src/services/mapper.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('retorna undefined para input vacío', () => {
    expect(truncate(undefined, 40)).toBeUndefined();
    expect(truncate('', 40)).toBeUndefined();
  });

  it('no trunca strings más cortos que el límite', () => {
    expect(truncate('Hola', 40)).toBe('Hola');
  });

  it('trunca strings más largos que el límite', () => {
    const long = 'A'.repeat(50);
    expect(truncate(long, 20)).toHaveLength(20);
  });
});

describe('parsePhone', () => {
  it('retorna undefined para input vacío', () => {
    const result = parsePhone(undefined);
    expect(result.number).toBeUndefined();
    expect(result.countryCode).toBe('CL');
  });

  it('separa código de país +56 (Chile)', () => {
    const result = parsePhone('+56912345678');
    expect(result.number).toBe('912345678');
    expect(result.countryCode).toBe('CL');
  });

  it('detecta código 56 sin +', () => {
    const result = parsePhone('56912345678');
    expect(result.number).toBe('912345678');
    expect(result.countryCode).toBe('CL');
  });

  it('maneja número local sin código de país', () => {
    const result = parsePhone('912345678');
    expect(result.number).toBe('912345678');
    expect(result.countryCode).toBe('CL');
  });

  it('limpia espacios, guiones y paréntesis', () => {
    const result = parsePhone('+56 (9) 1234-5678');
    expect(result.number).toBe('912345678');
    expect(result.countryCode).toBe('CL');
  });
});

describe('yearToDate', () => {
  it('convierte año a fecha SAP', () => {
    expect(yearToDate('2005')).toBe('2005-01-01');
  });

  it('retorna undefined para año inválido', () => {
    expect(yearToDate(undefined)).toBeUndefined();
    expect(yearToDate('abc')).toBeUndefined();
    expect(yearToDate('1800')).toBeUndefined();
  });
});

describe('sapDateToISO', () => {
  it('convierte /Date(epoch)/ a ISO string', () => {
    const iso = sapDateToISO('/Date(1700000000000)/');
    expect(iso).toBe(new Date(1700000000000).toISOString());
  });

  it('retorna undefined para formato inválido', () => {
    expect(sapDateToISO(undefined)).toBeUndefined();
    expect(sapDateToISO('2024-01-15')).toBeUndefined();
  });
});

describe('isoToSapDate', () => {
  it('convierte ISO date a /Date(epoch)/', () => {
    const result = isoToSapDate('2025-12-31');
    expect(result).toMatch(/^\/Date\(\d+\)\/$/);
  });

  it('convierte ISO datetime completo', () => {
    const result = isoToSapDate('2025-12-31T00:00:00.000Z');
    expect(result).toBe(`/Date(${new Date('2025-12-31T00:00:00.000Z').getTime()})/`);
  });

  it('retorna undefined para input vacío', () => {
    expect(isoToSapDate(undefined)).toBeUndefined();
    expect(isoToSapDate('')).toBeUndefined();
  });
});

describe('sapDateTimeToMs', () => {
  it('combina date y time en milisegundos', () => {
    const ms = sapDateTimeToMs('/Date(1700000000000)/', 'PT12H30M00S');
    // 12h30m = 45000 segundos = 45000000 ms
    expect(ms).toBe(1700000000000 + 45000000);
  });

  it('funciona solo con date (sin time)', () => {
    const ms = sapDateTimeToMs('/Date(1700000000000)/', undefined);
    expect(ms).toBe(1700000000000);
  });

  it('retorna undefined si date es undefined', () => {
    expect(sapDateTimeToMs(undefined, 'PT12H00M00S')).toBeUndefined();
  });
});

describe('sapDateTimeOffsetToMs', () => {
  it('parsea ISO datetime', () => {
    const ms = sapDateTimeOffsetToMs('2024-01-15T10:30:00.000Z');
    expect(ms).toBe(new Date('2024-01-15T10:30:00.000Z').getTime());
  });

  it('retorna undefined para input inválido', () => {
    expect(sapDateTimeOffsetToMs(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HubSpot Contact → SAP BP Persona
// ---------------------------------------------------------------------------

describe('contactToSapBP', () => {
  it('genera payload de creación con constantes correctas', () => {
    const payload = contactToSapBP({
      firstname: 'Juan',
      lastname: 'Pérez',
      email: 'juan@test.cl',
      phone: '+56912345678',
    }, '210581802294');

    expect(payload.BusinessPartnerCategory).toBe('1');
    expect(payload.BusinessPartnerGrouping).toBe(SAP_CONSTANTS.BP_GROUPING);
    expect(payload.FirstName).toBe('Juan');
    expect(payload.LastName).toBe('Pérez');
    expect(payload.CorrespondenceLanguage).toBe('ES');
    expect(payload.BusinessPartnerIDByExtSystem).toBe('210581802294');
  });

  it('incluye roles FLCU00 y FLCU01', () => {
    const payload = contactToSapBP({ firstname: 'Test' }, '123');

    const roles = payload.to_BusinessPartnerRole?.results;
    expect(roles).toHaveLength(2);
    expect(roles?.[0].BusinessPartnerRole).toBe('FLCU00');
    expect(roles?.[1].BusinessPartnerRole).toBe('FLCU01');
  });

  it('incluye CustomerCompany con CC, PT y RA', () => {
    const payload = contactToSapBP({ firstname: 'Test' }, '123');

    const cc = payload.to_Customer?.to_CustomerCompany?.results?.[0];
    expect(cc?.CompanyCode).toBe(SAP_CONSTANTS.COMPANY_CODE);
    expect(cc?.PaymentTerms).toBe(SAP_CONSTANTS.PAYMENT_TERMS);
    expect(cc?.ReconciliationAccount).toBe(SAP_CONSTANTS.RECONCILIATION_ACCOUNT);
  });

  it('trunca BusinessPartnerIDByExtSystem a 20 chars', () => {
    const longId = '123456789012345678901234567890'; // 30 chars
    const payload = contactToSapBP({ firstname: 'Test' }, longId);
    expect(payload.BusinessPartnerIDByExtSystem).toHaveLength(20);
  });

  it('trunca NaturalPersonEmployerName a 35 chars', () => {
    const longCompany = 'A'.repeat(50);
    const payload = contactToSapBP({ company: longCompany }, '123');
    expect(payload.NaturalPersonEmployerName).toHaveLength(35);
  });

  it('separa código de país del teléfono', () => {
    const payload = contactToSapBP({ phone: '+56912345678' }, '123');
    const address = payload.to_BusinessPartnerAddress?.results?.[0] as Record<string, unknown>;
    const phones = address?.to_PhoneNumber as { results: Array<{ PhoneNumber: string; DestinationLocationCountry: string }> };
    expect(phones.results[0].PhoneNumber).toBe('912345678');
    expect(phones.results[0].DestinationLocationCountry).toBe('CL');
  });
});

describe('contactToSapBPUpdate', () => {
  it('solo incluye campos con valor', () => {
    const update = contactToSapBPUpdate({ firstname: 'Carlos' });
    expect(update.FirstName).toBe('Carlos');
    expect(update.LastName).toBeUndefined();
  });

  it('retorna objeto vacío si no hay cambios', () => {
    const update = contactToSapBPUpdate({});
    expect(Object.keys(update)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HubSpot Company → SAP BP Organización
// ---------------------------------------------------------------------------

describe('companyToSapBP', () => {
  it('genera payload de creación con Category=2', () => {
    const payload = companyToSapBP({
      name: 'Empresa Test',
      rut: '12.345.678-9',
    }, '53147869965');

    expect(payload.BusinessPartnerCategory).toBe('2');
    expect(payload.OrganizationBPName1).toBe('Empresa Test');
    expect(payload.BusinessPartnerIDByExtSystem).toBe('53147869965');
  });

  it('incluye RUT como BPTaxNumber tipo CO3', () => {
    const payload = companyToSapBP({ rut: '12.345.678-9' }, '123');
    const tax = payload.to_BusinessPartnerTax?.results;
    expect(tax).toHaveLength(1);
    expect(tax?.[0].BPTaxType).toBe('CO3');
    expect(tax?.[0].BPTaxNumber).toBe('12.345.678-9');
  });

  it('no incluye tax si rut es undefined', () => {
    const payload = companyToSapBP({ name: 'Test' }, '123');
    expect(payload.to_BusinessPartnerTax?.results).toHaveLength(0);
  });

  it('usa condicion_venta como PaymentTerms', () => {
    const payload = companyToSapBP({ condicion_venta: 'NT60' }, '123');
    const cc = payload.to_Customer?.to_CustomerCompany?.results?.[0];
    expect(cc?.PaymentTerms).toBe('NT60');
  });

  it('trunca OrganizationBPName1 a 40 chars', () => {
    const longName = 'A'.repeat(60);
    const payload = companyToSapBP({ name: longName }, '123');
    expect(payload.OrganizationBPName1).toHaveLength(40);
  });
});

describe('companyToSapBPUpdate', () => {
  it('transforma campos de actualización', () => {
    const update = companyToSapBPUpdate({
      name: 'Nuevo Nombre',
      razon_social: 'Razón Social Ltda.',
    });
    expect(update.OrganizationBPName1).toBe('Nuevo Nombre');
    expect(update.OrganizationBPName3).toBe('Razón Social Ltda.');
    expect(update.SearchTerm1).toBe('Razón Social Ltda.');
  });

  it('trunca SearchTerm1 a 20 chars', () => {
    const longRS = 'A'.repeat(30);
    const update = companyToSapBPUpdate({ razon_social: longRS });
    expect(update.SearchTerm1).toHaveLength(20);
    expect(update.OrganizationBPName3).toHaveLength(30); // max 40, no trunca
  });
});

// ---------------------------------------------------------------------------
// HubSpot Deal → SAP Sales Order
// ---------------------------------------------------------------------------

describe('dealToSalesOrder', () => {
  it('genera payload con constantes de Química Sur', () => {
    const payload = dealToSalesOrder({
      dealname: 'Deal Test',
      closedate: '2024-06-30',
      deal_currency_code: 'CLP',
    }, '100000030');

    expect(payload.SalesOrderType).toBe('OR');
    expect(payload.SalesOrganization).toBe('4601');
    expect(payload.DistributionChannel).toBe('CF');
    expect(payload.OrganizationDivision).toBe('10');
    expect(payload.SoldToParty).toBe('100000030');
  });

  it('prioriza orden_de_compra_o_contratoo sobre dealname', () => {
    const payload = dealToSalesOrder({
      dealname: 'Deal Name',
      orden_de_compra_o_contratoo: 'OC-12345',
    }, '100000030');

    expect(payload.PurchaseOrderByCustomer).toBe('OC-12345');
  });

  it('usa dealname si orden_de_compra_o_contratoo no existe', () => {
    const payload = dealToSalesOrder({ dealname: 'Deal Name' }, '100000030');
    expect(payload.PurchaseOrderByCustomer).toBe('Deal Name');
  });

  it('prioriza fecha_de_entrega sobre closedate y convierte a /Date()/', () => {
    const payload = dealToSalesOrder({
      closedate: '2024-06-30',
      fecha_de_entrega: '2024-07-15',
    }, '100000030');

    expect(payload.RequestedDeliveryDate).toMatch(/^\/Date\(\d+\)\/$/);
    // Verificar que usó fecha_de_entrega (julio) no closedate (junio)
    const epochMs = parseInt(payload.RequestedDeliveryDate!.match(/\d+/)![0], 10);
    const date = new Date(epochMs);
    expect(date.getUTCMonth()).toBe(6); // Julio = 6 (0-indexed)
  });

  it('crea un ítem con material Q01 y unidad L', () => {
    const payload = dealToSalesOrder({
      cuanto_es_la_cantidad_requerida_del_producto_: '500',
    }, '100000030');

    const items = payload.to_Item?.results;
    expect(items).toHaveLength(1);
    expect(items?.[0].Material).toBe('Q01');
    expect(items?.[0].RequestedQuantity).toBe('500');
    expect(items?.[0].RequestedQuantityUnit).toBe('L');
  });

  it('usa cantidad=1 por defecto si cuanto_es_la_cantidad_requerida_del_producto_ no existe', () => {
    const payload = dealToSalesOrder({}, '100000030');
    expect(payload.to_Item?.results?.[0].RequestedQuantity).toBe('1');
  });

  it('usa CLP como moneda por defecto', () => {
    const payload = dealToSalesOrder({}, '100000030');
    expect(payload.TransactionCurrency).toBe('CLP');
  });
});

describe('dealToSalesOrderUpdate', () => {
  it('prioriza orden_de_compra_o_contratoo sobre dealname en update', () => {
    const update = dealToSalesOrderUpdate({
      dealname: 'Old Name',
      orden_de_compra_o_contratoo: 'OC-NEW',
    });
    expect(update.PurchaseOrderByCustomer).toBe('OC-NEW');
  });

  it('retorna objeto vacío si no hay cambios relevantes', () => {
    const update = dealToSalesOrderUpdate({ pipeline: '132611721' }); // pipeline no se sincroniza
    expect(Object.keys(update)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SAP → HubSpot (inversos)
// ---------------------------------------------------------------------------

describe('sapBPToContactUpdate', () => {
  it('transforma BP Persona a properties de Contact', () => {
    const props = sapBPToContactUpdate(
      {
        BusinessPartnerCategory: '1',
        BusinessPartnerGrouping: 'BP02',
        CorrespondenceLanguage: 'ES',
        FirstName: 'Juan',
        LastName: 'Pérez',
        NaturalPersonEmployerName: 'Mi Empresa',
      },
      {
        StreetName: 'Av. Principal 123',
        CityName: 'Santiago',
        Country: 'CL',
      },
      'juan@test.cl',
      '912345678',
      '987654321',
    );

    expect(props.firstname).toBe('Juan');
    expect(props.lastname).toBe('Pérez');
    expect(props.company).toBe('Mi Empresa');
    expect(props.email).toBe('juan@test.cl');
    expect(props.phone).toBe('912345678');
    expect(props.mobilephone).toBe('987654321');
    expect(props.address).toBe('Av. Principal 123');
    expect(props.city).toBe('Santiago');
    expect(props.country).toBe('CL');
  });

  it('omite campos vacíos', () => {
    const props = sapBPToContactUpdate({
      BusinessPartnerCategory: '1',
      BusinessPartnerGrouping: 'BP02',
      CorrespondenceLanguage: 'ES',
      FirstName: 'Juan',
    });

    expect(props.firstname).toBe('Juan');
    expect(props.lastname).toBeUndefined();
    expect(props.email).toBeUndefined();
  });
});

describe('sapBPToCompanyUpdate', () => {
  it('transforma BP Organización a properties de Company', () => {
    const props = sapBPToCompanyUpdate(
      {
        BusinessPartnerCategory: '2',
        BusinessPartnerGrouping: 'BP02',
        CorrespondenceLanguage: 'ES',
        OrganizationBPName1: 'Empresa SAP',
        OrganizationBPName3: 'Razón Social',
        OrganizationFoundationDate: '2005-01-01',
      },
      undefined,
      undefined,
      '12.345.678-9',
    );

    expect(props.name).toBe('Empresa SAP');
    expect(props.razon_social).toBe('Razón Social');
    expect(props.founded_year).toBe('2005');
    expect(props.rut).toBe('12.345.678-9');
  });
});

describe('salesOrderToDealUpdate', () => {
  it('transforma Sales Order a properties de Deal', () => {
    const epoch = new Date('2024-06-30').getTime();
    const props = salesOrderToDealUpdate({
      SalesOrderType: 'OR',
      SalesOrganization: '4601',
      DistributionChannel: 'CF',
      OrganizationDivision: '10',
      SoldToParty: '100000030',
      PurchaseOrderByCustomer: 'OC-12345',
      TotalNetAmount: '1500000',
      RequestedDeliveryDate: `/Date(${epoch})/`,
      TransactionCurrency: 'CLP',
      to_Item: {
        results: [{ Material: 'Q01', RequestedQuantity: '500', RequestedQuantityUnit: 'L' }],
      },
    });

    expect(props.dealname).toBe('OC-12345');
    expect(props.amount).toBe('1500000');
    expect(props.closedate).toBe('2024-06-30');
    expect(props.deal_currency_code).toBe('CLP');
    expect(props.orden_de_compra_o_contratoo).toBe('OC-12345');
    expect(props.cuanto_es_la_cantidad_requerida_del_producto_).toBe('500');
  });
});
