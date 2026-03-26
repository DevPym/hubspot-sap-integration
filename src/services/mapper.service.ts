/**
 * mapper.service.ts — Transformaciones de datos HubSpot <-> SAP.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RESPONSABILIDADES                                                      │
 * │  ─────────────────                                                      │
 * │  1. Convertir datos de HubSpot a payloads válidos para SAP OData v2    │
 * │  2. Convertir datos de SAP a properties válidas para HubSpot CRM v3   │
 * │  3. Manejar truncamientos (max chars SAP), formato de teléfonos,      │
 * │     conversiones de fecha, y constantes de Química Sur                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CONEXIONES                                                             │
 * │  ──────────                                                             │
 * │  Usa tipos de:                                                          │
 * │    - src/adapters/sap/sap.types.ts                                      │
 * │    - src/adapters/hubspot/hubspot.types.ts                              │
 * │                                                                         │
 * │  Consumido por:                                                         │
 * │    - src/services/sync.service.ts — antes de enviar datos al destino   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  NOTAS                                                                  │
 * │  ─────                                                                  │
 * │  - Funciones PURAS: no llaman APIs ni tocan la base de datos           │
 * │  - Los campos que no tienen equivalente en el sistema destino se       │
 * │    ignoran silenciosamente                                              │
 * │  - Los campos vacíos o undefined se omiten del payload                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type {
  SapCreateBPPayload,
  SapUpdateBPPayload,
  SapCreateSalesOrderPayload,
  SapUpdateSalesOrderPayload,
  SapBusinessPartner,
  SapBPAddress,
  SapBPPhone,
  SapBPEmail,
  SapSalesOrder,
  SapSalesOrderItem,
} from '../adapters/sap/sap.types';

import type {
  HubSpotContactProperties,
  HubSpotCompanyProperties,
  HubSpotDealProperties,
} from '../adapters/hubspot/hubspot.types';

import { env } from '../config/env';

// ---------------------------------------------------------------------------
// Constantes SAP — leídas desde variables de entorno
// ---------------------------------------------------------------------------

/**
 * Constantes SAP construidas desde env vars.
 * Todos los valores tienen defaults en env.schema.ts.
 * Se pueden cambiar sin modificar código (solo env vars en Railway).
 *
 * Valores por defecto verificados en producción de Química Sur (2026-03-24):
 *   TAX_TYPE: CO3 (RUT Chile — verificado en producción con BPs 100000030, 100000031)
 *   RECONCILIATION_ACCOUNT: 10200600 (NO 12120100)
 */
export const SAP_CONSTANTS = {
  get BP_GROUPING() { return env.SAP_BP_GROUPING; },
  get CORRESPONDENCE_LANGUAGE() { return env.SAP_CORRESPONDENCE_LANGUAGE; },
  get COMPANY_CODE() { return env.SAP_COMPANY_CODE; },
  get PAYMENT_TERMS() { return env.SAP_DEFAULT_PAYMENT_TERMS; },
  get RECONCILIATION_ACCOUNT() { return env.SAP_RECONCILIATION_ACCOUNT; },
  get TAX_TYPE_RUT() { return env.SAP_TAX_TYPE; },
  get ROLES() { return env.SAP_BP_ROLES.split(','); },
  get SALES_ORDER_TYPE() { return env.SAP_SALES_ORDER_TYPE; },
  get SALES_ORGANIZATION() { return env.SAP_SALES_ORGANIZATION; },
  get DISTRIBUTION_CHANNEL() { return env.SAP_DISTRIBUTION_CHANNEL; },
  get ORGANIZATION_DIVISION() { return env.SAP_ORGANIZATION_DIVISION; },
  get MATERIAL() { return env.SAP_DEFAULT_MATERIAL; },
  get MATERIAL_UNIT() { return env.SAP_DEFAULT_MATERIAL_UNIT; },
  get DEFAULT_CURRENCY() { return env.SAP_DEFAULT_CURRENCY; },
  get DEFAULT_COUNTRY() { return env.SAP_DEFAULT_COUNTRY; },
};

/** Límites de longitud de campos SAP */
const MAX_LENGTHS = {
  ORGANIZATION_BP_NAME: 40,
  SEARCH_TERM: 20,
  EMPLOYER_NAME: 35,
  PURCHASE_ORDER: 35,
  EXTERNAL_ID: 20,
} as const;

// ---------------------------------------------------------------------------
// Diccionario País → Código ISO 3166-1 alpha-2
// ---------------------------------------------------------------------------

/**
 * Convierte nombres de país (texto libre de HubSpot) a código ISO 2 letras para SAP.
 * SAP rechaza nombres completos como "Chile" — requiere "CL".
 *
 * Incluye variaciones comunes: con/sin tilde, inglés/español, mayúsculas/minúsculas.
 * Si el valor ya es un código ISO de 2 letras, lo retorna tal cual.
 * Si no se reconoce, defaultea a 'CL' (Química Sur es empresa chilena).
 */
const COUNTRY_MAP: Record<string, string> = {
  // Chile
  'chile': 'CL',
  'cl': 'CL',
  // Argentina
  'argentina': 'AR',
  'ar': 'AR',
  // Perú
  'peru': 'PE',
  'perú': 'PE',
  'pe': 'PE',
  // Colombia
  'colombia': 'CO',
  'co': 'CO',
  // Brasil
  'brazil': 'BR',
  'brasil': 'BR',
  'br': 'BR',
  // México
  'mexico': 'MX',
  'méxico': 'MX',
  'mx': 'MX',
  // Bolivia
  'bolivia': 'BO',
  'bo': 'BO',
  // Ecuador
  'ecuador': 'EC',
  'ec': 'EC',
  // Paraguay
  'paraguay': 'PY',
  'py': 'PY',
  // Uruguay
  'uruguay': 'UY',
  'uy': 'UY',
  // Venezuela
  'venezuela': 'VE',
  've': 'VE',
  // Panamá
  'panama': 'PA',
  'panamá': 'PA',
  'pa': 'PA',
  // Estados Unidos
  'united states': 'US',
  'united states of america': 'US',
  'estados unidos': 'US',
  'usa': 'US',
  'us': 'US',
  // España
  'spain': 'ES',
  'españa': 'ES',
  'es': 'ES',
  // China
  'china': 'CN',
  'cn': 'CN',
  // Alemania
  'germany': 'DE',
  'alemania': 'DE',
  'de': 'DE',
};

/**
 * Normaliza un valor de país de HubSpot a código ISO 2 letras para SAP.
 *
 * Flujo:
 *   1. Si es undefined/vacío → retorna 'CL' (default)
 *   2. Si ya es código ISO 2 letras → retorna en mayúsculas
 *   3. Busca en diccionario por nombre completo
 *   4. Si no encuentra → retorna 'CL' y loguea warning
 */
export function normalizeCountryCode(country: string | undefined): string {
  if (!country) return SAP_CONSTANTS.DEFAULT_COUNTRY;

  const trimmed = country.trim();
  if (!trimmed) return SAP_CONSTANTS.DEFAULT_COUNTRY;

  // Si ya es código ISO 2 letras, retornar en mayúsculas
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    // Verificar que sea un código conocido (o asumir que es válido)
    return COUNTRY_MAP[trimmed.toLowerCase()] || upper;
  }

  // Buscar en diccionario por nombre
  const normalized = COUNTRY_MAP[trimmed.toLowerCase()];
  if (normalized) return normalized;

  // No reconocido — loguear y defaultear
  console.warn(`[mapper] ⚠️ País no reconocido: "${country}" — usando default '${SAP_CONSTANTS.DEFAULT_COUNTRY}'. Agregar al diccionario COUNTRY_MAP si es válido.`);
  return SAP_CONSTANTS.DEFAULT_COUNTRY;
}

// ---------------------------------------------------------------------------
// Diccionario Región Chile → Código SAP (ISO 3166-2:CL)
// ---------------------------------------------------------------------------

/**
 * SAP requiere códigos de región específicos, no texto libre.
 * Verificados contra SAP producción (2026-03-24).
 *
 * Códigos válidos: AP, TA, AN, AT, CO, VS, RM, LI, ML, NB, AR, LR, LL, AI, MA
 */
const REGION_MAP_CL: Record<string, string> = {
  // Arica y Parinacota (XV)
  'arica y parinacota': 'AP', 'arica': 'AP', 'ap': 'AP', 'xv': 'AP',
  // Tarapacá (I)
  'tarapaca': 'TA', 'tarapacá': 'TA', 'ta': 'TA', 'i': 'TA',
  // Antofagasta (II)
  'antofagasta': 'AN', 'an': 'AN', 'ii': 'AN',
  // Atacama (III)
  'atacama': 'AT', 'at': 'AT', 'iii': 'AT',
  // Coquimbo (IV)
  'coquimbo': 'CO', 'iv': 'CO',
  // Valparaíso (V)
  'valparaiso': 'VS', 'valparaíso': 'VS', 'vs': 'VS', 'v': 'VS',
  // Metropolitana (RM)
  'metropolitana': 'RM', 'region metropolitana': 'RM', 'santiago': 'RM', 'rm': 'RM', 'xiii': 'RM',
  // O'Higgins (VI)
  'ohiggins': 'LI', "o'higgins": 'LI', 'li': 'LI', 'vi': 'LI', 'rancagua': 'LI',
  // Maule (VII)
  'maule': 'ML', 'ml': 'ML', 'vii': 'ML',
  // Ñuble (XVI)
  'nuble': 'NB', 'ñuble': 'NB', 'nb': 'NB', 'xvi': 'NB',
  // Biobío (VIII) - SAP no tiene BB, usamos NB (Ñuble) como más cercano o AR
  'biobio': 'NB', 'bío bío': 'NB', 'biobío': 'NB', 'viii': 'NB',
  // Araucanía (IX)
  'araucania': 'AR', 'araucanía': 'AR', 'la araucania': 'AR', 'la araucanía': 'AR', 'ar': 'AR', 'ix': 'AR',
  // Los Ríos (XIV)
  'los rios': 'LR', 'los ríos': 'LR', 'lr': 'LR', 'xiv': 'LR',
  // Los Lagos (X)
  'los lagos': 'LL', 'll': 'LL', 'x': 'LL',
  // Aysén (XI)
  'aysen': 'AI', 'aysén': 'AI', 'ai': 'AI', 'xi': 'AI',
  // Magallanes (XII)
  'magallanes': 'MA', 'magallanes y antartica': 'MA', 'ma': 'MA', 'xii': 'MA',
};

/**
 * Normaliza una región/estado de HubSpot al código SAP para Chile.
 * Si el país no es Chile o no se reconoce la región, retorna undefined
 * (para no enviar Region inválido a SAP).
 */
export function normalizeRegionCode(region: string | undefined, country?: string): string | undefined {
  if (!region) return undefined;

  const trimmed = region.trim();
  if (!trimmed) return undefined;

  // Solo normalizar para Chile (por ahora)
  const countryCode = country ? normalizeCountryCode(country) : 'CL';
  if (countryCode !== 'CL') {
    // Para otros países, pasar el valor tal cual (puede funcionar o SAP lo rechazará)
    return trimmed;
  }

  const normalized = REGION_MAP_CL[trimmed.toLowerCase()];
  if (normalized) return normalized;

  // Si ya es un código de 2 letras, verificar si es válido
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    if (REGION_MAP_CL[trimmed.toLowerCase()]) return REGION_MAP_CL[trimmed.toLowerCase()];
    // Asumir que es un código válido
    return upper;
  }

  console.warn(`[mapper] ⚠️ Región no reconocida: "${region}" — omitiendo. Agregar al diccionario REGION_MAP_CL.`);
  return undefined; // No enviar Region inválido — SAP rechaza todo el PATCH
}

// ---------------------------------------------------------------------------
// Diccionario Condición de Pago HubSpot ↔ SAP
// ---------------------------------------------------------------------------

/**
 * HubSpot usa texto legible ("30 días") y SAP usa códigos ("NT30").
 * Mapeo bidireccional verificado contra las opciones reales de HubSpot:
 *   "Pago contado", "30 días", "45 días", "60 días", "90 días"
 */
const PAYMENT_TERMS_HS_TO_SAP: Record<string, string> = {
  'pago contado': 'NT00',
  '30 días': 'NT30',
  '30 dias': 'NT30',
  '45 días': 'NT45',
  '45 dias': 'NT45',
  '60 días': 'NT60',
  '60 dias': 'NT60',
  '90 días': 'NT90',
  '90 dias': 'NT90',
  // También aceptar códigos SAP directamente
  'nt00': 'NT00',
  'nt30': 'NT30',
  'nt45': 'NT45',
  'nt60': 'NT60',
  'nt90': 'NT90',
};

const PAYMENT_TERMS_SAP_TO_HS: Record<string, string> = {
  'NT00': 'Pago contado',
  'NT30': '30 días',
  'NT45': '45 días',
  'NT60': '60 días',
  'NT90': '90 días',
};

/**
 * Convierte condición de pago de HubSpot (texto) a código SAP.
 * Si ya es un código SAP válido, lo retorna tal cual.
 * Si no se reconoce, retorna undefined para no enviar valor inválido.
 */
export function paymentTermsToSap(hsValue: string | undefined): string | undefined {
  if (!hsValue) return undefined;
  const normalized = PAYMENT_TERMS_HS_TO_SAP[hsValue.toLowerCase().trim()];
  if (normalized) return normalized;
  // Si ya parece ser código SAP (NT##), retornar tal cual
  if (/^NT\d{2}$/i.test(hsValue.trim())) return hsValue.trim().toUpperCase();
  console.warn(`[mapper] ⚠️ Condición de pago no reconocida: "${hsValue}"`);
  return undefined;
}

/**
 * Convierte código de condición de pago SAP a texto HubSpot.
 */
export function paymentTermsToHubSpot(sapCode: string | undefined): string | undefined {
  if (!sapCode) return undefined;
  return PAYMENT_TERMS_SAP_TO_HS[sapCode.toUpperCase().trim()];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Elimina recursivamente propiedades con valor null o undefined de un objeto.
 * SAP OData v2 ignora campos null en el payload pero puede causar errores
 * si null llega en sub-entidades. Es más limpio no enviarlos.
 *
 * También limpia strings vacíos ("") para evitar sobrescribir datos en SAP.
 */
export function cleanNulls<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => cleanNulls(item)) as T;
  }
  if (typeof obj === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      if (typeof val === 'string' && val === '') continue;
      cleaned[key] = cleanNulls(val);
    }
    return cleaned as T;
  }
  return obj;
}

/**
 * Trunca un string al máximo permitido por SAP.
 * Retorna undefined si el input es vacío/undefined.
 */
export function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.substring(0, maxLength);
}

/**
 * Normaliza un RUT chileno para SAP (max 11 caracteres en BPTaxNumber).
 *
 * HubSpot puede tener formatos como: "99.404.490-0", "99404490-0", "994044900".
 * SAP acepta max 11 chars. Removemos puntos y dejamos el guión + dígito verificador.
 *
 * Ejemplo:
 *   "99.404.490-0"  → "99404490-0" (10 chars, OK)
 *   "11.111.111-1"  → "11111111-1" (10 chars, OK)
 *   "99404490-0"    → "99404490-0" (sin cambio)
 */
export function normalizeRut(rut: string | undefined): string | undefined {
  if (!rut) return undefined;
  // Remover puntos, mantener guión y dígito verificador
  return rut.replace(/\./g, '').trim();
}

/**
 * Parsea un número de teléfono para separar código de país y número local.
 *
 * SAP requiere el código de país en DestinationLocationCountry (ISO 2 letras),
 * NO en el campo PhoneNumber. Incluirlo genera warning T5/194.
 *
 * Ejemplo:
 *   "+56912345678" → { number: "912345678", countryCode: "CL" }
 *   "912345678"    → { number: "912345678", countryCode: "CL" } (default Chile)
 *
 * Solo soportamos +56 (Chile) como detección automática.
 * Para otros países se usa el default "CL".
 */
export function parsePhone(phone: string | undefined): {
  number: string | undefined;
  countryCode: string;
} {
  if (!phone) return { number: undefined, countryCode: 'CL' };

  const cleaned = phone.replace(/[\s\-()]/g, '');

  if (cleaned.startsWith('+56')) {
    return { number: cleaned.substring(3), countryCode: 'CL' };
  }
  if (cleaned.startsWith('56') && cleaned.length > 9) {
    return { number: cleaned.substring(2), countryCode: 'CL' };
  }

  // Sin prefijo reconocido: asumir número local chileno
  return { number: cleaned.replace(/^\+/, ''), countryCode: 'CL' };
}

/**
 * Convierte un año (string "2005") a fecha SAP (string "2005-01-01").
 * Retorna undefined si el año no es válido.
 */
export function yearToDate(year: string | undefined): string | undefined {
  if (!year) return undefined;
  const parsed = parseInt(year, 10);
  if (isNaN(parsed) || parsed < 1900 || parsed > 2100) return undefined;
  return `${parsed}-01-01`;
}

/**
 * Convierte fecha SAP OData v2 "/Date(epoch_ms)/" a ISO string.
 * Retorna undefined si no puede parsear.
 *
 * Ejemplo: "/Date(1700000000000)/" → "2023-11-14T22:13:20.000Z"
 */
export function sapDateToISO(sapDate: string | undefined): string | undefined {
  if (!sapDate) return undefined;
  const match = sapDate.match(/\/Date\((\d+)\)\//);
  if (!match) return undefined;
  return new Date(parseInt(match[1], 10)).toISOString();
}

/**
 * Convierte LastChangeDate ("/Date(epoch)/") + LastChangeTime ("PT12H30M00S")
 * a un timestamp en milisegundos.
 * Retorna undefined si no puede parsear.
 */
export function sapDateTimeToMs(
  lastChangeDate: string | undefined,
  lastChangeTime: string | undefined,
): number | undefined {
  if (!lastChangeDate) return undefined;

  const dateMatch = lastChangeDate.match(/\/Date\((\d+)\)\//);
  if (!dateMatch) return undefined;

  let ms = parseInt(dateMatch[1], 10);

  // Sumar tiempo si existe (formato PT##H##M##S)
  if (lastChangeTime) {
    const timeMatch = lastChangeTime.match(/PT(\d+)H(\d+)M(\d+)S/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = parseInt(timeMatch[3], 10);
      ms += (hours * 3600 + minutes * 60 + seconds) * 1000;
    }
  }

  return ms;
}

/**
 * Convierte una fecha ISO de HubSpot (ej: "2025-12-31" o "2025-12-31T00:00:00.000Z")
 * al formato OData v2 de SAP: "/Date(epoch_ms)/".
 *
 * SAP OData v2 usa este formato para campos DateTime.
 * Retorna undefined si la fecha no es válida.
 */
export function isoToSapDate(isoDate: string | undefined): string | undefined {
  if (!isoDate) return undefined;
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return undefined;
  return `/Date(${date.getTime()})/`;
}

/**
 * Convierte SAP LastChangeDateTime (DateTimeOffset) a milisegundos.
 * Formato: "2024-01-15T10:30:00.000Z" o "/Date(epoch)/"
 */
export function sapDateTimeOffsetToMs(dateTimeOffset: string | undefined): number | undefined {
  if (!dateTimeOffset) return undefined;

  // Intentar formato ISO
  const date = new Date(dateTimeOffset);
  if (!isNaN(date.getTime())) return date.getTime();

  // Intentar formato OData /Date(epoch)/
  return sapDateToISO(dateTimeOffset) ? new Date(sapDateToISO(dateTimeOffset)!).getTime() : undefined;
}

// ---------------------------------------------------------------------------
// HubSpot Contact → SAP BP Persona (Category=1)
// ---------------------------------------------------------------------------

/**
 * Transforma un Contact de HubSpot en payload de creación de BP Persona en SAP.
 *
 * Incluye todas las constantes requeridas: Category, Grouping, Roles,
 * CustomerCompany, Address con email/phone/mobile.
 *
 * @param props - Propiedades del Contact de HubSpot
 * @param hubspotId - ID del Contact para BusinessPartnerIDByExtSystem
 */
export function contactToSapBP(
  props: HubSpotContactProperties,
  hubspotId: string,
): SapCreateBPPayload {
  const phone = parsePhone(props.phone);
  const mobile = parsePhone(props.mobilephone);

  // Construir sub-entidades del Address
  const addressPhones: SapBPPhone[] = [];
  if (phone.number) {
    addressPhones.push({
      OrdinalNumber: '1',
      PhoneNumber: phone.number,
      DestinationLocationCountry: phone.countryCode,
      PhoneNumberType: '1', // fijo
    });
  }
  if (mobile.number) {
    addressPhones.push({
      OrdinalNumber: mobile.number === phone.number ? '2' : '1',
      PhoneNumber: mobile.number,
      DestinationLocationCountry: mobile.countryCode,
      PhoneNumberType: '3', // móvil
    });
  }

  const emailEntries: SapBPEmail[] = [];
  if (props.email) {
    emailEntries.push({
      OrdinalNumber: '1',
      EmailAddress: props.email,
    });
  }

  const address: SapBPAddress = {
    StreetName: props.address,
    CityName: props.city,
    PostalCode: props.zip,
    Country: normalizeCountryCode(props.country),
    Region: normalizeRegionCode(props.state, props.country),
    District: props.comuna,
    Language: SAP_CONSTANTS.CORRESPONDENCE_LANGUAGE,
  };

  const payload: SapCreateBPPayload = {
    BusinessPartnerCategory: '1',
    BusinessPartnerGrouping: SAP_CONSTANTS.BP_GROUPING,
    FirstName: props.firstname,
    LastName: props.lastname,
    CorrespondenceLanguage: SAP_CONSTANTS.CORRESPONDENCE_LANGUAGE,
    NaturalPersonEmployerName: truncate(props.company, MAX_LENGTHS.EMPLOYER_NAME),
    BusinessPartnerIDByExtSystem: truncate(hubspotId, MAX_LENGTHS.EXTERNAL_ID),
    to_BusinessPartnerAddress: {
      results: [{
        ...address,
        to_EmailAddress: emailEntries.length > 0
          ? { results: emailEntries } as unknown as SapBPEmail[]
          : undefined,
        to_PhoneNumber: addressPhones.length > 0
          ? { results: addressPhones } as unknown as SapBPPhone[]
          : undefined,
      } as SapBPAddress & { to_EmailAddress?: unknown; to_PhoneNumber?: unknown }],
    },
    to_BusinessPartnerTax: { results: [] },
    to_BusinessPartnerRole: {
      results: SAP_CONSTANTS.ROLES.map((role) => ({
        BusinessPartnerRole: role,
      })),
    },
    to_Customer: {
      to_CustomerCompany: {
        results: [{
          CompanyCode: SAP_CONSTANTS.COMPANY_CODE,
          PaymentTerms: SAP_CONSTANTS.PAYMENT_TERMS,
          ReconciliationAccount: SAP_CONSTANTS.RECONCILIATION_ACCOUNT,
        }],
      },
    },
  };

  // Limpiar null/undefined/vacíos — SAP los ignora o causa errores
  return cleanNulls(payload);
}

/**
 * Transforma propiedades actualizadas de un Contact de HubSpot
 * en payload de PATCH para SAP BP Persona.
 *
 * Solo incluye campos con valor (no envía undefined/null a SAP).
 */
export function contactToSapBPUpdate(props: Partial<HubSpotContactProperties>): SapUpdateBPPayload {
  const update: SapUpdateBPPayload = {};

  if (props.firstname !== undefined) update.FirstName = props.firstname;
  if (props.lastname !== undefined) update.LastName = props.lastname;
  if (props.company !== undefined) {
    update.NaturalPersonEmployerName = truncate(props.company, MAX_LENGTHS.EMPLOYER_NAME);
  }

  return update;
}

/**
 * Extrae los campos de dirección de un Contact/Company de HubSpot
 * para hacer PATCH al Address sub-entity de SAP.
 *
 * SAP BP Address es una sub-entity separada. En OData v2, el deep insert
 * a veces no escribe todos los campos del Address. Por eso hacemos
 * un PATCH explícito después del CREATE/UPDATE.
 *
 * Los campos de email, phone y mobile se manejan como sub-sub-entities
 * del Address y requieren POST/PATCH separados.
 */
export function extractAddressPayload(
  props: Partial<HubSpotContactProperties> | Partial<HubSpotCompanyProperties>,
): Record<string, string | undefined> {
  const address: Record<string, string | undefined> = {};

  if ('address' in props && props.address) address.StreetName = props.address;
  if ('city' in props && props.city) address.CityName = props.city;
  if ('zip' in props && props.zip) address.PostalCode = props.zip;
  if ('country' in props && props.country) address.Country = normalizeCountryCode(props.country);
  if ('state' in props && props.state) {
    const region = normalizeRegionCode(props.state, 'country' in props ? props.country : undefined);
    if (region) address.Region = region;
  }
  if ('comuna' in props && props.comuna) address.District = props.comuna;

  return address;
}

/**
 * Extrae datos de email para POST/PATCH a la sub-entity EmailAddress.
 */
export function extractEmailPayload(
  props: Partial<HubSpotContactProperties> | Partial<HubSpotCompanyProperties>,
): { OrdinalNumber: string; EmailAddress: string } | null {
  const email = 'email' in props ? props.email : undefined;
  if (!email) return null;
  return { OrdinalNumber: '1', EmailAddress: email };
}

/**
 * Extrae datos de teléfono para POST/PATCH a la sub-entity PhoneNumber.
 */
export function extractPhonePayload(
  props: Partial<HubSpotContactProperties> | Partial<HubSpotCompanyProperties>,
): { OrdinalNumber: string; PhoneNumber: string; DestinationLocationCountry: string; PhoneNumberType: string } | null {
  const phoneStr = 'phone' in props ? props.phone : undefined;
  if (!phoneStr) return null;
  const phone = parsePhone(phoneStr);
  if (!phone.number) return null;
  return {
    OrdinalNumber: '1',
    PhoneNumber: phone.number,
    DestinationLocationCountry: phone.countryCode,
    PhoneNumberType: '1',
  };
}

/**
 * Extrae datos de celular para POST/PATCH a la sub-entity MobilePhoneNumber.
 */
export function extractMobilePayload(
  props: Partial<HubSpotContactProperties>,
): { OrdinalNumber: string; PhoneNumber: string; DestinationLocationCountry: string; PhoneNumberType: string } | null {
  if (!props.mobilephone) return null;
  const mobile = parsePhone(props.mobilephone);
  if (!mobile.number) return null;
  return {
    OrdinalNumber: '1',
    PhoneNumber: mobile.number,
    DestinationLocationCountry: mobile.countryCode,
    PhoneNumberType: '3', // móvil
  };
}

// ---------------------------------------------------------------------------
// HubSpot Company → SAP BP Organización (Category=2)
// ---------------------------------------------------------------------------

/**
 * Transforma una Company de HubSpot en payload de creación de BP Organización en SAP.
 *
 * @param props - Propiedades de la Company de HubSpot
 * @param hubspotId - ID de la Company para BusinessPartnerIDByExtSystem
 */
export function companyToSapBP(
  props: HubSpotCompanyProperties,
  hubspotId: string,
): SapCreateBPPayload {
  const phone = parsePhone(props.phone);

  const addressPhones: SapBPPhone[] = [];
  if (phone.number) {
    addressPhones.push({
      OrdinalNumber: '1',
      PhoneNumber: phone.number,
      DestinationLocationCountry: phone.countryCode,
      PhoneNumberType: '1',
    });
  }

  const address: SapBPAddress = {
    StreetName: props.address,
    CityName: props.city,
    PostalCode: props.zip,
    Country: normalizeCountryCode(props.country),
    Region: normalizeRegionCode(props.state, props.country),
    District: props.comuna,
    Language: SAP_CONSTANTS.CORRESPONDENCE_LANGUAGE,
  };

  // Tax (RUT) si existe
  const taxEntries = props.rut_empresa
    ? [{ BPTaxType: SAP_CONSTANTS.TAX_TYPE_RUT, BPTaxNumber: normalizeRut(props.rut_empresa)! }]
    : [];

  // PaymentTerms: usar condicion_venta custom o default NT30
  const paymentTerms = props.condicion_venta || SAP_CONSTANTS.PAYMENT_TERMS;

  const payload: SapCreateBPPayload = {
    BusinessPartnerCategory: '2',
    BusinessPartnerGrouping: SAP_CONSTANTS.BP_GROUPING,
    OrganizationBPName1: truncate(props.name, MAX_LENGTHS.ORGANIZATION_BP_NAME),
    OrganizationBPName2: truncate(props.description, MAX_LENGTHS.ORGANIZATION_BP_NAME),
    OrganizationBPName3: truncate(props.razon_social, MAX_LENGTHS.ORGANIZATION_BP_NAME),
    SearchTerm1: truncate(props.razon_social, MAX_LENGTHS.SEARCH_TERM),
    OrganizationFoundationDate: yearToDate(props.founded_year),
    CorrespondenceLanguage: SAP_CONSTANTS.CORRESPONDENCE_LANGUAGE,
    BusinessPartnerIDByExtSystem: truncate(hubspotId, MAX_LENGTHS.EXTERNAL_ID),
    to_BusinessPartnerAddress: {
      results: [{
        ...address,
        to_PhoneNumber: addressPhones.length > 0
          ? { results: addressPhones } as unknown as SapBPPhone[]
          : undefined,
      } as SapBPAddress & { to_PhoneNumber?: unknown }],
    },
    to_BusinessPartnerTax: { results: taxEntries },
    to_BusinessPartnerRole: {
      results: SAP_CONSTANTS.ROLES.map((role) => ({
        BusinessPartnerRole: role,
      })),
    },
    to_Customer: {
      to_CustomerCompany: {
        results: [{
          CompanyCode: SAP_CONSTANTS.COMPANY_CODE,
          PaymentTerms: paymentTerms,
          ReconciliationAccount: SAP_CONSTANTS.RECONCILIATION_ACCOUNT,
        }],
      },
    },
  };

  return cleanNulls(payload);
}

/**
 * Transforma propiedades actualizadas de una Company de HubSpot
 * en payload de PATCH para SAP BP Organización.
 */
export function companyToSapBPUpdate(props: Partial<HubSpotCompanyProperties>): SapUpdateBPPayload {
  const update: SapUpdateBPPayload = {};

  if (props.name !== undefined) {
    update.OrganizationBPName1 = truncate(props.name, MAX_LENGTHS.ORGANIZATION_BP_NAME);
  }
  if (props.description !== undefined) {
    update.OrganizationBPName2 = truncate(props.description, MAX_LENGTHS.ORGANIZATION_BP_NAME);
  }
  if (props.razon_social !== undefined) {
    update.OrganizationBPName3 = truncate(props.razon_social, MAX_LENGTHS.ORGANIZATION_BP_NAME);
    update.SearchTerm1 = truncate(props.razon_social, MAX_LENGTHS.SEARCH_TERM);
  }
  if (props.founded_year !== undefined) {
    update.OrganizationFoundationDate = yearToDate(props.founded_year);
  }

  return update;
}

// ---------------------------------------------------------------------------
// HubSpot Deal → SAP Sales Order
// ---------------------------------------------------------------------------

/**
 * Transforma un Deal de HubSpot en payload de creación de Sales Order en SAP.
 *
 * ⭐ IMPORTANTE: Requiere el SAP BP ID de la Company asociada (SoldToParty).
 * La Company debe existir previamente en id_map.
 *
 * @param props - Propiedades del Deal de HubSpot
 * @param sapCompanyId - SAP Business Partner ID de la Company asociada (obtenido de id_map)
 */
export function dealToSalesOrder(
  props: HubSpotDealProperties,
  sapCompanyId: string,
): SapCreateSalesOrderPayload {
  // PurchaseOrderByCustomer: priorizar orden_de_compra custom sobre dealname
  const purchaseOrder = truncate(
    props.orden_de_compra_o_contratoo || props.dealname,
    MAX_LENGTHS.PURCHASE_ORDER,
  );

  // RequestedDeliveryDate: priorizar fecha_de_entrega custom sobre closedate
  // Convertir de ISO (HubSpot) a /Date(epoch)/ (SAP OData v2)
  const deliveryDateISO = props.fecha_de_entrega || props.closedate;
  const deliveryDate = isoToSapDate(deliveryDateISO);

  // Ítems: al menos un ítem con el material por defecto
  const items: Omit<SapSalesOrderItem, 'SalesOrder'>[] = [];
  items.push({
    SalesOrderItem: '10',
    Material: SAP_CONSTANTS.MATERIAL,
    RequestedQuantity: props.cuanto_es_la_cantidad_requerida_del_producto_ || '1',
    RequestedQuantityUnit: SAP_CONSTANTS.MATERIAL_UNIT,
  });

  const payload: SapCreateSalesOrderPayload = {
    SalesOrderType: SAP_CONSTANTS.SALES_ORDER_TYPE,
    SalesOrganization: SAP_CONSTANTS.SALES_ORGANIZATION,
    DistributionChannel: SAP_CONSTANTS.DISTRIBUTION_CHANNEL,
    OrganizationDivision: SAP_CONSTANTS.ORGANIZATION_DIVISION,
    SoldToParty: sapCompanyId,
    PurchaseOrderByCustomer: purchaseOrder,
    TransactionCurrency: props.deal_currency_code || SAP_CONSTANTS.DEFAULT_CURRENCY,
    RequestedDeliveryDate: deliveryDate,
    CustomerPaymentTerms: paymentTermsToSap(props.condicion_de_pago),
    to_Item: { results: items },
  };

  return cleanNulls(payload);
}

/**
 * Transforma propiedades actualizadas de un Deal de HubSpot
 * en payload de PATCH para SAP Sales Order.
 *
 * ⚠️ Nota: TotalNetAmount es READ-ONLY en SAP, nunca se envía.
 */
export function dealToSalesOrderUpdate(
  props: Partial<HubSpotDealProperties>,
): SapUpdateSalesOrderPayload {
  const update: SapUpdateSalesOrderPayload = {};

  const purchaseOrder = props.orden_de_compra_o_contratoo || props.dealname;
  if (purchaseOrder !== undefined) {
    update.PurchaseOrderByCustomer = truncate(purchaseOrder, MAX_LENGTHS.PURCHASE_ORDER);
  }

  const deliveryDateISO = props.fecha_de_entrega || props.closedate;
  if (deliveryDateISO !== undefined) {
    update.RequestedDeliveryDate = isoToSapDate(deliveryDateISO);
  }

  if (props.deal_currency_code !== undefined) {
    update.TransactionCurrency = props.deal_currency_code;
  }
  if (props.condicion_de_pago !== undefined) {
    const sapTerms = paymentTermsToSap(props.condicion_de_pago);
    if (sapTerms) update.CustomerPaymentTerms = sapTerms;
  }

  return update;
}

// ---------------------------------------------------------------------------
// SAP BP → HubSpot Contact (inverso)
// ---------------------------------------------------------------------------

/**
 * Transforma un BP Persona de SAP en properties de HubSpot Contact.
 * Usado para sincronización SAP → HubSpot.
 *
 * @param bp - Business Partner de SAP (Category='1')
 * @param address - Dirección del BP (opcional, si fue expandida)
 * @param email - Email del BP (opcional)
 * @param phone - Teléfono fijo del BP (opcional)
 * @param mobile - Teléfono móvil del BP (opcional)
 */
export function sapBPToContactUpdate(
  bp: SapBusinessPartner,
  address?: SapBPAddress,
  email?: string,
  phone?: string,
  mobile?: string,
): Partial<HubSpotContactProperties> {
  const props: Partial<HubSpotContactProperties> = {};

  if (bp.FirstName) props.firstname = bp.FirstName;
  if (bp.LastName) props.lastname = bp.LastName;
  if (bp.NaturalPersonEmployerName) props.company = bp.NaturalPersonEmployerName;
  if (email) props.email = email;
  if (phone) props.phone = phone;
  if (mobile) props.mobilephone = mobile;

  if (address) {
    if (address.StreetName) props.address = address.StreetName;
    if (address.CityName) props.city = address.CityName;
    if (address.PostalCode) props.zip = address.PostalCode;
    if (address.Country) props.country = address.Country;
    if (address.Region) props.state = address.Region;
    if (address.District) props.comuna = address.District;
  }

  return props;
}

// ---------------------------------------------------------------------------
// SAP BP → HubSpot Company (inverso)
// ---------------------------------------------------------------------------

/**
 * Transforma un BP Organización de SAP en properties de HubSpot Company.
 *
 * @param bp - Business Partner de SAP (Category='2')
 * @param address - Dirección del BP (opcional)
 * @param phone - Teléfono del BP (opcional)
 * @param rut - BPTaxNumber con tipo CO3 (opcional)
 */
export function sapBPToCompanyUpdate(
  bp: SapBusinessPartner,
  address?: SapBPAddress,
  phone?: string,
  rut?: string,
): Partial<HubSpotCompanyProperties> {
  const props: Partial<HubSpotCompanyProperties> = {};

  if (bp.OrganizationBPName1) props.name = bp.OrganizationBPName1;
  if (bp.OrganizationBPName2) props.description = bp.OrganizationBPName2;
  if (bp.OrganizationBPName3) props.razon_social = bp.OrganizationBPName3;
  if (bp.OrganizationFoundationDate) {
    // Extraer solo el año de la fecha
    const year = bp.OrganizationFoundationDate.substring(0, 4);
    if (year && !isNaN(parseInt(year, 10))) props.founded_year = year;
  }
  if (phone) props.phone = phone;
  if (rut) props.rut_empresa = rut;

  if (address) {
    if (address.StreetName) props.address = address.StreetName;
    if (address.CityName) props.city = address.CityName;
    if (address.PostalCode) props.zip = address.PostalCode;
    if (address.Country) props.country = address.Country;
    if (address.Region) props.state = address.Region;
    if (address.District) props.comuna = address.District;
  }

  return props;
}

// ---------------------------------------------------------------------------
// SAP Sales Order → HubSpot Deal (inverso)
// ---------------------------------------------------------------------------

/**
 * Transforma una Sales Order de SAP en properties de HubSpot Deal.
 *
 * ⚠️ amount (TotalNetAmount) es READ-ONLY calculado por SAP,
 * pero sí se sincroniza hacia HubSpot para reflejar el total.
 *
 * @param so - Sales Order de SAP
 */
export function salesOrderToDealUpdate(
  so: SapSalesOrder,
): Partial<HubSpotDealProperties> {
  const props: Partial<HubSpotDealProperties> = {};

  if (so.PurchaseOrderByCustomer) props.dealname = so.PurchaseOrderByCustomer;
  if (so.TotalNetAmount) props.amount = so.TotalNetAmount;
  if (so.RequestedDeliveryDate) {
    // Convertir /Date(epoch)/ de SAP a ISO para HubSpot
    const iso = sapDateToISO(so.RequestedDeliveryDate);
    if (iso) props.closedate = iso.split('T')[0]; // Solo fecha YYYY-MM-DD
  }
  if (so.TransactionCurrency) props.deal_currency_code = so.TransactionCurrency;
  if (so.CustomerPaymentTerms) {
    props.condicion_de_pago = paymentTermsToHubSpot(so.CustomerPaymentTerms) || so.CustomerPaymentTerms;
  }
  if (so.RequestedDeliveryDate) {
    const iso = sapDateToISO(so.RequestedDeliveryDate);
    if (iso) props.fecha_de_entrega = iso.split('T')[0];
  }
  if (so.PurchaseOrderByCustomer) props.orden_de_compra_o_contratoo = so.PurchaseOrderByCustomer;

  // Cantidad del primer ítem
  if (so.to_Item?.results?.[0]?.RequestedQuantity) {
    props.cuanto_es_la_cantidad_requerida_del_producto_ = so.to_Item.results[0].RequestedQuantity;
  }

  return props;
}
