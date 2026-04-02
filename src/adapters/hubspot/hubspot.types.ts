/**
 * hubspot.types.ts — Tipos TypeScript para la API HubSpot CRM v3.
 *
 * Notas de diseño:
 * - TODAS las propiedades HubSpot son `string | undefined`, incluso las numéricas
 *   (amount, closedate, etc.). La API devuelve todo como string en JSON.
 * - `HubSpotObject<T>` es un genérico que evita duplicar id/createdAt/updatedAt/archived.
 * - Distinción crítica verificada en producción:
 *     Contact → usa `lastmodifieddate` (NO `hs_lastmodifieddate`, que llega null en GET list)
 *     Company → usa `hs_lastmodifieddate`
 *     Deal    → usa `hs_lastmodifieddate`
 *
 * Propiedades custom de Química Sur (grupo "quimica_del_sur"):
 *   Contact: comuna, id_sap
 *   Company: comuna, rut_empresa, condicion_venta, razon_social, rut_representante_legal, id_sap
 *   Deal:    condicion_de_pago, fecha_de_entrega, orden_de_compra_o_contratoo,
 *            cuanto_es_la_cantidad_requerida_del_producto_, id_sap
 *
 * ⚠️ Antes de implementar mapper.service.ts (Fase 5) se deben confirmar
 *    las propiedades custom adicionales directamente en HubSpot Properties.
 */

// ---------------------------------------------------------------------------
// Objeto CRM genérico
// ---------------------------------------------------------------------------

/**
 * Estructura base de cualquier objeto CRM de HubSpot (Contact, Company, Deal).
 * El campo `id` es string aunque en webhooks llega como número — la API REST
 * siempre devuelve strings.
 */
export interface HubSpotObject<T> {
  id: string;
  properties: T;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * Propiedades de un Contact de HubSpot.
 *
 * ⚠️ CRÍTICO: usar `lastmodifieddate` para Last-Write-Wins, NO `hs_lastmodifieddate`.
 *    `hs_lastmodifieddate` llega null en GET list para Contact.
 *
 * Mapeo con SAP BP Persona (Category='1'):
 *   firstname    ↔ FirstName
 *   lastname     ↔ LastName
 *   email        ↔ to_EmailAddress.EmailAddress (sub-entidad Address)
 *   phone        ↔ to_PhoneNumber.PhoneNumber (Type=1, sin código país)
 *   mobilephone  ↔ to_MobilePhoneNumber.PhoneNumber (Type=3)
 *   address      ↔ StreetName
 *   city         ↔ CityName
 *   zip          ↔ PostalCode
 *   country      ↔ Country (ISO 2 letras)
 *   state        ↔ Region
 *   comuna       ↔ District
 *   company      ↔ NaturalPersonEmployerName (max 35 chars)
 *   jobtitle     ↔ BusinessPartnerOccupation (mapeo código)
 *   salutation   ↔ FormOfAddress (mapeo código)
 *   industry     ↔ Industry (mapeo código)
 */
export interface HubSpotContactProperties {
  // --- Datos personales ---
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  mobilephone?: string;

  // --- Dirección ---
  address?: string;
  city?: string;
  zip?: string;
  country?: string;
  state?: string;

  // --- Información laboral ---
  company?: string;
  jobtitle?: string;

  // --- Timestamp para Last-Write-Wins ---
  /** USAR ESTE para LWW (no hs_lastmodifieddate) */
  lastmodifieddate?: string;

  // --- Propiedades custom Química Sur (grupo quimica_del_sur) ---
  /** Nombre de la comuna (distrito) */
  comuna?: string;
  /** ID del Business Partner en SAP (ej: "100000030") */
  id_sap?: string;
}

export type HubSpotContact = HubSpotObject<HubSpotContactProperties>;

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

/**
 * Propiedades de una Company de HubSpot.
 *
 * Mapeo con SAP BP Organización (Category='2'):
 *   name             ↔ OrganizationBPName1 (max 40 chars)
 *   description      → OrganizationBPName2 (overflow)
 *   phone            ↔ to_PhoneNumber.PhoneNumber
 *   address/city/... → mismos campos Address que Contact
 *   rut_empresa      ↔ BPTaxNumber (BPTaxType=CO3)
 *   condicion_venta  ↔ CustomerCompany.PaymentTerms
 *   industry         ↔ Industry
 *   founded_year     ↔ OrganizationFoundationDate (año→fecha)
 *   razon_social     ↔ SearchTerm1 (max 20ch) / OrganizationBPName3 (max 40ch)
 *   banco_1/2        ↔ to_BusinessPartnerBank
 *
 * Solo HubSpot (sin equivalente en SAP v1):
 *   domain, numberofemployees, annualrevenue, giro, vendedor,
 *   monto_credito, representante_legal, contacto_compras, sucursal_1-5
 */
export interface HubSpotCompanyProperties {
  // --- Información básica ---
  name?: string;
  description?: string;
  phone?: string;
  industry?: string;
  /** Año de fundación como string (ej: '2005') */
  founded_year?: string;

  // --- Dirección ---
  address?: string;
  city?: string;
  zip?: string;
  country?: string;
  state?: string;

  // --- Timestamp para Last-Write-Wins ---
  hs_lastmodifieddate?: string;

  // --- Propiedades custom Química Sur (grupo quimica_del_sur) ---
  /** Nombre de la comuna (distrito) */
  comuna?: string;
  /** RUT empresa formato chileno (ej: '12.345.678-9') */
  rut_empresa?: string;
  /** Condición de venta / término de pago */
  condicion_venta?: string;
  /** Razón social legal */
  razon_social?: string;
  /** RUT del representante legal (solo HubSpot, no sincroniza con SAP) */
  rut_representante_legal?: string;
  /** ID del Business Partner en SAP (ej: "100000030") */
  id_sap?: string;
}

export type HubSpotCompany = HubSpotObject<HubSpotCompanyProperties>;

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

/**
 * Propiedades de un Deal de HubSpot.
 *
 * Mapeo con SAP Sales Order:
 *   dealname              ↔ PurchaseOrderByCustomer (max 35 chars, prioridad menor)
 *   orden_de_compra       ↔ PurchaseOrderByCustomer (⭐ priorizar sobre dealname)
 *   amount                ← TotalNetAmount (READ-ONLY en SAP, no se envía en sync)
 *   closedate             ↔ RequestedDeliveryDate
 *   deal_currency_code    ↔ TransactionCurrency
 *   condicion_de_pago     ↔ CustomerPaymentTerms
 *   fecha_de_entrega      ↔ RequestedDeliveryDate (priorizar sobre closedate)
 *   cantidad_producto     ↔ to_Item.RequestedQuantity
 *   dealstage             ← OverallSDProcessStatus + OverallSDDocumentRejectionSts
 *   hubspot_owner_id      ↔ to_Partner[ER].Personnel (mapeo usuarios)
 *
 * Nota: associatedCompany se obtiene vía associations API, no desde properties.
 * La Company asociada debe existir en id_map antes de crear el SalesOrder.
 *
 * Solo HubSpot (sin equivalente SAP en v1):
 *   pipeline, los ~40 campos custom de cálculo de facturación/precio/margen
 */
export interface HubSpotDealProperties {
  // --- Datos del deal ---
  dealname?: string;
  /** READ-ONLY desde SAP (TotalNetAmount calculado desde ítems) */
  amount?: string;
  /** Descripción del deal → to_Text LongTextID='0002' en SAP */
  description?: string;
  /** Fecha de cierre esperada (ISO 8601) */
  closedate?: string;
  deal_currency_code?: string;
  dealstage?: string;
  pipeline?: string;
  hubspot_owner_id?: string;

  // --- Timestamp para Last-Write-Wins ---
  hs_lastmodifieddate?: string;

  // --- Propiedades custom Química Sur (grupo quimica_del_sur) ---
  /** Término/condición de pago (enumeration) */
  condicion_de_pago?: string;
  /** Fecha de entrega (priorizar sobre closedate para SalesOrder) */
  fecha_de_entrega?: string;
  /**
   * Archivo de compra o contrato (tipo file en HubSpot).
   * ⚠️ Nombre interno real: orden_de_compra_o_contratoo
   * Se usa el valor como referencia para PurchaseOrderByCustomer en SAP.
   */
  orden_de_compra_o_contratoo?: string;
  /**
   * Cantidad requerida del producto (ítem principal del SalesOrder).
   * ⚠️ Nombre interno real: cuanto_es_la_cantidad_requerida_del_producto_
   */
  cuanto_es_la_cantidad_requerida_del_producto_?: string;
  /** ID del Sales Order en SAP (ej: "50") */
  id_sap?: string;
}

export type HubSpotDeal = HubSpotObject<HubSpotDealProperties>;

// ---------------------------------------------------------------------------
// Payloads de request para HubSpot CRM v3
// ---------------------------------------------------------------------------

/**
 * Payload para PATCH (actualización parcial) de cualquier objeto CRM.
 * HubSpot PATCH devuelve 200 con el objeto actualizado completo.
 */
export interface HubSpotUpdatePayload<T> {
  properties: Partial<T>;
}

export type HubSpotUpdateContact = HubSpotUpdatePayload<HubSpotContactProperties>;
export type HubSpotUpdateCompany = HubSpotUpdatePayload<HubSpotCompanyProperties>;
export type HubSpotUpdateDeal = HubSpotUpdatePayload<HubSpotDealProperties>;

// ---------------------------------------------------------------------------
// Respuestas de lista CRM v3
// ---------------------------------------------------------------------------

/** Respuesta paginada de la API de lista de HubSpot */
export interface HubSpotListResponse<T> {
  results: T[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Asociaciones HubSpot (ej: Deal → Company)
// ---------------------------------------------------------------------------

export interface HubSpotAssociation {
  id: string;
  type: string;
}

export interface HubSpotAssociationsResponse {
  results: HubSpotAssociation[];
}
