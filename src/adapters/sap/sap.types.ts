/**
 * sap.types.ts — Tipos TypeScript para la API SAP S/4HANA Cloud OData v2.
 *
 * Notas de diseño:
 * - Los campos de fecha SAP en OData v2 llegan como string '/Date(epoch_ms)/'
 *   (ej: '/Date(1700000000000)/'). No se usa Date de JS para evitar conversiones
 *   silenciosas en modo strict.
 * - Los decimales (TotalNetAmount, RequestedQuantity) llegan como string para
 *   preservar precisión numérica.
 * - Los campos READ-ONLY de SAP están excluidos de los tipos de payload (Omit)
 *   para que TypeScript impida enviarlos por error.
 * - Las sub-entidades OData v2 (to_BusinessPartnerAddress, etc.) usan el
 *   formato estándar { results: T[] }.
 *
 * Constantes verificadas en producción (Química Sur):
 *   SalesOrderType      = "OR"
 *   SalesOrganization   = "4601"
 *   DistributionChannel = "CF"
 *   OrganizationDivision= "10"
 *   Material            = "Q01"
 *   MaterialUnit        = "L"
 *   CompanyCode         = "4610"
 *   BPGrouping          = "BP02"
 *   BPTaxType (RUT)     = "CO3"
 *   PaymentTerms        = "NT30"
 *   ReconciliationAcct  = "12120100"
 *   CorrespondenceLang  = "ES"
 *   Roles               = ["FLCU00", "FLCU01"]
 */

// ---------------------------------------------------------------------------
// Respuestas OData v2 estándar
// ---------------------------------------------------------------------------

/** Envuelve una entidad individual en la respuesta OData v2 { d: T } */
export interface ODataResponse<T> {
  d: T;
}

/** Envuelve una colección en la respuesta OData v2 { d: { results: T[] } } */
export interface ODataListResponse<T> {
  d: {
    results: T[];
  };
}

// ---------------------------------------------------------------------------
// Business Partner (BP) — API_BUSINESS_PARTNER
// ---------------------------------------------------------------------------

/**
 * Representa un Business Partner de SAP (persona física o jurídica).
 * Category='1' → Persona (Contact en HubSpot)
 * Category='2' → Organización (Company en HubSpot)
 */
export interface SapBusinessPartner {
  BusinessPartner?: string;
  /** '1' = Persona física, '2' = Organización */
  BusinessPartnerCategory: '1' | '2';
  BusinessPartnerGrouping: string; // 'BP02'
  /** Solo para Category='1' */
  FirstName?: string;
  /** Solo para Category='1' */
  LastName?: string;
  /** Solo para Category='2' — hasta 40 caracteres */
  OrganizationBPName1?: string;
  /** Solo para Category='2' — overflow de nombre largo */
  OrganizationBPName2?: string;
  /** Solo para Category='2' — razón social (hasta 40 caracteres) */
  OrganizationBPName3?: string;
  CorrespondenceLanguage: string; // 'ES'
  /** Término de búsqueda corto (hasta 20 caracteres) */
  SearchTerm1?: string;
  /** Código de industria SAP */
  Industry?: string;
  /** Ocupación del BP persona — mapeo desde jobtitle HubSpot */
  BusinessPartnerOccupation?: string;
  /** Tratamiento / saludo — mapeo desde salutation HubSpot */
  FormOfAddress?: string;
  /** Empleador del BP persona — mapeo desde company HubSpot (hasta 35 chars) */
  NaturalPersonEmployerName?: string;
  /**
   * ID externo del BP — aquí se guarda el HubSpot ID.
   * Máximo 20 caracteres (limitación SAP verificada en producción).
   */
  BusinessPartnerIDByExtSystem?: string;
  /** Fecha de fundación — solo para Category='2' (formato: YYYY-MM-DD) */
  OrganizationFoundationDate?: string;
  /**
   * Fecha del último cambio (READ-ONLY, generado por SAP).
   * Formato OData v2: '/Date(epoch_ms)/'
   * Usado para Last-Write-Wins junto con LastChangeTime.
   */
  LastChangeDate?: string;
  /** Hora del último cambio (READ-ONLY). Complementa LastChangeDate para LWW. */
  LastChangeTime?: string;
  /** DateTime combinado (READ-ONLY). Disponible en algunos endpoints. */
  LastChangeDateTime?: string;
}

// ---------------------------------------------------------------------------
// BP Address — sub-entidad to_BusinessPartnerAddress
// ---------------------------------------------------------------------------

/**
 * Dirección de un Business Partner.
 * Nota: email, teléfono y móvil son sub-entidades de Address, no campos directos del BP.
 */
export interface SapBPAddress {
  BusinessPartner?: string;
  AddressID?: string;
  BusinessPartnerAddressID?: string;
  StreetName?: string;
  CityName?: string;
  PostalCode?: string;
  /** Código de país ISO 2 letras (ej: 'CL', 'US') */
  Country?: string;
  /** Código de región según tabla SAP */
  Region?: string;
  /** Distrito / Comuna (custom Química Sur) */
  District?: string;
  /** Idioma de la dirección */
  Language?: string;
}

// ---------------------------------------------------------------------------
// BP Phone — sub-entidad to_PhoneNumber dentro de Address
// ---------------------------------------------------------------------------

/**
 * Teléfono de un Business Partner.
 *
 * ⚠️ VERIFICADO EN PRODUCCIÓN: NO incluir código de país en PhoneNumber.
 * El código de país va en DestinationLocationCountry (warning T5/194 si se incluye en número).
 *
 * Clave compuesta de la entidad: AddressID + Person + OrdinalNumber
 * Type='1' → Teléfono fijo
 * Type='3' → Teléfono móvil
 */
export interface SapBPPhone {
  AddressID?: string;
  Person?: string;
  OrdinalNumber?: string;
  PhoneNumber?: string;
  /** Código de país sin '+' (ej: 'CL', 'US') */
  DestinationLocationCountry?: string;
  PhoneNumberExtension?: string;
  /** '1' = fijo, '3' = móvil */
  PhoneNumberType?: string;
}

// ---------------------------------------------------------------------------
// BP Email — sub-entidad to_EmailAddress dentro de Address
// ---------------------------------------------------------------------------

/**
 * Email de un Business Partner.
 * Clave compuesta: AddressID + Person + OrdinalNumber
 */
export interface SapBPEmail {
  AddressID?: string;
  Person?: string;
  OrdinalNumber?: string;
  EmailAddress?: string;
}

// ---------------------------------------------------------------------------
// BP Tax Number — sub-entidad to_BusinessPartnerTax
// ---------------------------------------------------------------------------

/**
 * Número de identificación tributaria del BP.
 * Para Chile (Química Sur): BPTaxType = 'CO3' (RUT)
 */
export interface SapBPTaxNumber {
  BusinessPartner?: string;
  /** 'CO3' = RUT Chile */
  BPTaxType: string;
  BPTaxNumber: string;
}

// ---------------------------------------------------------------------------
// BP Role — sub-entidad to_BusinessPartnerRole
// ---------------------------------------------------------------------------

/**
 * Rol asignado al BP.
 * Roles requeridos para Química Sur: 'FLCU00' y 'FLCU01' (cliente)
 */
export interface SapBPRole {
  BusinessPartner?: string;
  /** Ej: 'FLCU00', 'FLCU01' */
  BusinessPartnerRole: string;
}

// ---------------------------------------------------------------------------
// Customer Company — sub-entidad to_CustomerCompany
// ---------------------------------------------------------------------------

/**
 * Datos financieros del cliente (vista contable del BP).
 * ⚠️ VERIFICADO EN PRODUCCIÓN: NO incluir Language en CustomerCompany.
 */
export interface SapCustomerCompany {
  BusinessPartner?: string;
  CompanyCode: string; // '4610'
  PaymentTerms?: string; // 'NT30'
  ReconciliationAccount?: string; // '12120100'
}

// ---------------------------------------------------------------------------
// BP Bank — sub-entidad to_BusinessPartnerBank
// ---------------------------------------------------------------------------

/** Cuenta bancaria del BP — sync para campos banco_1 / banco_2 de HubSpot */
export interface SapBPBank {
  BusinessPartner?: string;
  BankCountryKey?: string;
  BankInternalID?: string;
  BankAccountName?: string;
  BankAccount?: string;
}

// ---------------------------------------------------------------------------
// Payloads de request para Business Partner
// ---------------------------------------------------------------------------

/**
 * Payload para crear un nuevo BP (POST).
 * Excluye campos READ-ONLY y campos generados por SAP.
 * Incluye sub-entidades anidadas que SAP acepta en el payload inicial.
 */
export type SapCreateBPPayload = Omit<
  SapBusinessPartner,
  'BusinessPartner' | 'LastChangeDate' | 'LastChangeTime' | 'LastChangeDateTime'
> & {
  to_BusinessPartnerAddress?: { results: SapBPAddress[] };
  to_BusinessPartnerTax?: { results: SapBPTaxNumber[] };
  to_BusinessPartnerRole?: { results: SapBPRole[] };
  to_Customer?: {
    to_CustomerCompany?: { results: SapCustomerCompany[] };
  };
};

/**
 * Payload para actualizar un BP existente (PATCH).
 * Solo se envían los campos que cambiaron.
 * ⚠️ PATCH SAP devuelve 204 sin body.
 * ⚠️ Requiere header If-Match con ETag obtenido en GET previo.
 */
export type SapUpdateBPPayload = Partial<
  Omit<
    SapBusinessPartner,
    'BusinessPartner' | 'BusinessPartnerCategory' | 'BusinessPartnerGrouping' |
    'LastChangeDate' | 'LastChangeTime' | 'LastChangeDateTime'
  >
>;

// ---------------------------------------------------------------------------
// Sales Order — API_SALES_ORDER_SRV
// ---------------------------------------------------------------------------

/** Ítem de una Sales Order */
export interface SapSalesOrderItem {
  SalesOrder?: string;
  SalesOrderItem?: string;
  Material: string; // 'Q01'
  SalesOrderItemText?: string;
  /** Como string para preservar precisión decimal */
  RequestedQuantity?: string;
  RequestedQuantityUnit: string; // 'L'
}

/**
 * Sales Order de SAP.
 *
 * Constantes para Química Sur:
 *   SalesOrderType      = "OR"
 *   SalesOrganization   = "4601"
 *   DistributionChannel = "CF"
 *   OrganizationDivision= "10"
 *
 * ⚠️ TotalNetAmount es READ-ONLY (calculado desde los ítems por SAP).
 * ⚠️ ETag formato: W/"datetimeoffset'...'" (diferente al BP que es string plano).
 * ⚠️ PATCH devuelve 204 sin body.
 */
export interface SapSalesOrder {
  SalesOrder?: string;
  SalesOrderType: string; // 'OR'
  SalesOrganization: string; // '4601'
  DistributionChannel: string; // 'CF'
  OrganizationDivision: string; // '10'
  /** SAP BP ID de la empresa asociada (obtenido vía id_map) */
  SoldToParty: string;
  /** Número de orden de compra del cliente (hasta 35 chars) */
  PurchaseOrderByCustomer?: string;
  /** Código de moneda ISO (ej: 'CLP', 'USD') */
  TransactionCurrency?: string;
  /** Fecha de entrega solicitada (formato: YYYY-MM-DD) */
  RequestedDeliveryDate?: string;
  CustomerPaymentTerms?: string;
  /**
   * READ-ONLY — calculado automáticamente por SAP desde los ítems.
   * No incluir en payloads de creación/actualización.
   */
  TotalNetAmount?: string;
  /**
   * Estado general del proceso SD (READ-ONLY).
   * Usado para mapear dealstage en HubSpot.
   */
  OverallSDProcessStatus?: string;
  /**
   * Estado de rechazo del documento (READ-ONLY).
   * Combinado con OverallSDProcessStatus para mapear dealstage.
   */
  OverallSDDocumentRejectionSts?: string;
  /**
   * Timestamp del último cambio (READ-ONLY).
   * Formato DateTimeOffset — usado para Last-Write-Wins.
   * Ej: "2024-01-15T10:30:00.000Z"
   */
  LastChangeDateTime?: string;
  to_Item?: { results: SapSalesOrderItem[] };
}

/**
 * Payload para crear una nueva Sales Order (POST).
 * Excluye campos READ-ONLY.
 */
export type SapCreateSalesOrderPayload = Omit<
  SapSalesOrder,
  | 'SalesOrder'
  | 'TotalNetAmount'
  | 'OverallSDProcessStatus'
  | 'OverallSDDocumentRejectionSts'
  | 'LastChangeDateTime'
> & {
  to_Item?: { results: Omit<SapSalesOrderItem, 'SalesOrder'>[] };
};

/**
 * Payload para actualizar una Sales Order existente (PATCH).
 * Solo los campos editables según OData v2 de SAP.
 */
export type SapUpdateSalesOrderPayload = Partial<
  Pick<
    SapSalesOrder,
    | 'PurchaseOrderByCustomer'
    | 'RequestedDeliveryDate'
    | 'TransactionCurrency'
    | 'CustomerPaymentTerms'
  >
>;
