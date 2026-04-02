# Mapeo Campo a Campo — HubSpot ↔ SAP S/4HANA
## Química Sur · Integration Service v1.0 · VERSIÓN FINAL
### Documento de referencia para `mapper.service.ts`
### Todas las decisiones confirmadas ✅ — Abril 2026

---

## Leyenda

| Símbolo | Significado |
|---------|-------------|
| ↔ | Bidireccional (sync en ambas direcciones) |
| → | Solo HubSpot → SAP |
| ← | Solo SAP → HubSpot |
| 🔒 | Constante (valor fijo, no mapeado desde el otro sistema) |
| ⚠️ | Requiere transformación de formato |
| 🆕 | Custom property a crear en HubSpot |
| ✅ | Decisión confirmada por el usuario |

---

## 1. Company ↔ BusinessPartner (Organización · Category=2)

### 1.1 Campos del header del BP

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 1 | `name` | `OrganizationBPName1` | ↔ | ✅ Nombre comercial → Name1 |
| 2 | `razon_social` (custom) | `OrganizationBPName2` | ↔ | ✅ Razón social legal → Name2 |
| 3 | — | `BusinessPartnerCategory` | 🔒 | Siempre `"2"` (Organización) |
| 4 | — | `BusinessPartnerGrouping` | 🔒 | Siempre `"BP02"` |
| 5 | — | `CorrespondenceLanguage` | 🔒 | Siempre `"ES"` |
| 6 | `name` (primeros 20 chars) | `SearchTerm1` | → | SAP usa esto para búsquedas rápidas. Truncar a 20 chars |
| 7 | `rut` (custom, solo dígitos) | `SearchTerm2` | → | ✅ Duplicar RUT en SearchTerm2 para búsqueda rápida |
| 8 | `industry` | `to_BuPaIndustry.IndustrySector` | → | ✅ Sync v1. POST separado. Requiere tabla de valores SAP (*) |
| 9 | `giro` (custom) | `to_BuPaIndustry.IndustryKeyDescription` | → | ✅ Sync v1. Texto libre de giro tributario chileno |
| 10 | `website` | — | ✗ | Sin equivalente en SAP. Solo HubSpot |
| 11 | `domain` | — | ✗ | Sin equivalente en SAP. Solo HubSpot |
| 12 | `description` | — | ✗ | Sin equivalente directo. Solo HubSpot |
| 13 | `numberofemployees` | — | ✗ | Sin campo en BP estándar |
| 14 | `annualrevenue` | — | ✗ | Sin campo en BP estándar |
| 15 | `lifecyclestage` | — | ✗ | Concepto HubSpot sin equivalente SAP |
| 16 | `type` | — | ✗ | Solo HubSpot |
| 17 | `founded_year` | — | ✗ | Sin campo en BP |
| 18 | `address2` | — | ✗ | ✅ No se sincroniza |
| 19 | 🆕 `sap_bp_id` | `BusinessPartner` | ← | ID del BP en SAP. Read-only en HS |
| 20 | 🆕 `sap_customer_id` | `Customer` (vía `to_Customer`) | ← | Customer number generado por SAP |

### 1.2 Dirección (`to_BusinessPartnerAddress`)

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 21 | `address` | `StreetName` | ↔ | |
| 22 | `city` | `CityName` | ↔ | |
| 23 | `state` | `Region` | ↔ | ⚠️ SAP usa código (ej: `"RM"`). Tabla de mapeo en §4.5 |
| 24 | `zip` | `PostalCode` | ↔ | |
| 25 | `country` | `Country` | ↔ | ⚠️ Normalizar a ISO alpha-2. Tabla en §4.1 |
| 26 | `comuna` (custom) | `District` | ↔ | ✅ Comuna chilena → District SAP |
| 27 | — | `Language` | 🔒 | Siempre `"ES"` en la dirección |

### 1.3 Teléfono (`to_PhoneNumber` — POST separado vía Address)

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 28 | `phone` | `PhoneNumber` | ↔ | ⚠️ Sin código de país. Usar `DestinationLocationCountry` |
| 29 | — | `IsDefaultPhoneNumber` | 🔒 | `true` |
| 30 | — | `DestinationLocationCountry` | 🔒 | `"CL"` → `PhoneNumberType=1` (línea fija) |

### 1.4 Impuestos (`to_BusinessPartnerTax`)

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 31 | `rut` (custom) | `BPTaxNumber` | → | ⚠️ Transformar: `76.123.456-7` → `761234567`. Función en §4.2 |
| 32 | — | `BPTaxType` | 🔒 | Siempre `"CO3"` para Chile |

### 1.5 Roles (`to_BusinessPartnerRole`) — Constantes

| # | SAP Field | Valor |
|---|-----------|-------|
| 33 | `BusinessPartnerRole` | `"FLCU00"` 🔒 |
| 34 | `BusinessPartnerRole` | `"FLCU01"` 🔒 |

### 1.6 Customer Company (`to_Customer.to_CustomerCompany`)

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 35 | — | `CompanyCode` | 🔒 | `"4610"` |
| 36 | `condicion_venta` (custom) | `PaymentTerms` | ↔ | `NT30`, `NT60`, etc. |
| 37 | — | `ReconciliationAccount` | 🔒 | `"12120100"` |

### 1.7 Timestamps

| HubSpot | SAP | Uso |
|---------|-----|-----|
| `hs_lastmodifieddate` | `LastChangeDateTime` | Last-write-wins |

---

## 2. Contact ↔ BusinessPartner (Persona · Category=1)

### 2.1 Campos del header del BP

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 38 | `firstname` | `FirstName` | ↔ | |
| 39 | `lastname` | `LastName` | ↔ | |
| 40 | — | `BusinessPartnerCategory` | 🔒 | Siempre `"1"` (Persona) |
| 41 | — | `BusinessPartnerGrouping` | 🔒 | Siempre `"BP02"` |
| 42 | — | `CorrespondenceLanguage` | 🔒 | Siempre `"ES"` |
| 43 | `lastname` (20 chars) | `SearchTerm1` | → | Búsqueda rápida |
| 44 | `salutation` | `FormOfAddress` | ↔ | ⚠️ SAP códigos: `0001`=Sr., `0002`=Sra. Tabla en §4.4 |
| 45 | `jobtitle` | `SearchTerm2` | → | No hay campo nativo en BP persona para cargo |
| 46 | `company` | — | ✗ | Texto libre. Relación real vía associations |
| 47 | `lifecyclestage` | — | ✗ | Solo HubSpot |
| 48 | `website` | — | ✗ | Solo HubSpot |
| 49 | 🆕 `sap_bp_id` | `BusinessPartner` | ← | ID del BP |
| 50 | 🆕 `sap_customer_id` | `Customer` | ← | Customer number |

### 2.2 Dirección (`to_BusinessPartnerAddress`)

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 51 | `address` | `StreetName` | ↔ | |
| 52 | `city` | `CityName` | ↔ | |
| 53 | `state` | `Region` | ↔ | ⚠️ Código región SAP |
| 54 | `zip` | `PostalCode` | ↔ | |
| 55 | `country` | `Country` | ↔ | ⚠️ ISO alpha-2 |
| 56 | `comuna` (custom) | `District` | ↔ | ✅ |
| 57 | — | `Language` | 🔒 | `"ES"` |

### 2.3 Email (`to_EmailAddress` — POST separado)

| # | HubSpot Property | SAP Field | Dir |
|---|-----------------|-----------|-----|
| 58 | `email` | `EmailAddress` | ↔ |
| 59 | — | `IsDefaultEmailAddress` | 🔒 `true` |

### 2.4 Teléfono y Móvil

| # | HubSpot Property | SAP Field | Entidad | Dir |
|---|-----------------|-----------|---------|-----|
| 60 | `phone` | `PhoneNumber` | `to_PhoneNumber` (Type=1) | ↔ |
| 61 | `mobilephone` | `PhoneNumber` | `to_MobilePhoneNumber` (Type=3) | ↔ |
| 62 | — | `DestinationLocationCountry` | ambos | 🔒 `"CL"` |

### 2.5 Impuestos, Roles, Customer Company

Idéntico a Company (filas 31-37). Mismas constantes.

### 2.6 Timestamps

| HubSpot | SAP | Uso |
|---------|-----|-----|
| `lastmodifieddate` ⚠️ | `LastChangeDateTime` | ⚠️ Contacts usan `lastmodifieddate`, NO `hs_lastmodifieddate` |

---

## 3. Deal ↔ SalesOrder

### 3.1 Header de SalesOrder

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 63 | — | `SalesOrderType` | 🔒 | `"OR"` |
| 64 | — | `SalesOrganization` | 🔒 | `"4601"` |
| 65 | — | `DistributionChannel` | 🔒 | `"CF"` |
| 66 | — | `OrganizationDivision` | 🔒 | `"10"` |
| 67 | — | `TransactionCurrency` | 🔒 | ✅ `"CLP"` (pesos chilenos) |
| 68 | Company asociada → `sap_customer_id` | `SoldToParty` | → | ⚠️ Se resuelve vía `id_map`. Buscar Customer# de la Company vinculada al Deal |
| 69 | `orden_de_compra_o_contratoo` (custom) | `PurchaseOrderByCustomer` | ↔ | ✅ OC del cliente va aquí |
| 70 | `dealname` | `to_Text` → `LongText` | → | ✅ Nombre del deal va como nota de texto. `Language="ES"`, `LongTextID="0001"` |
| 71 | `fecha_de_entrega` (custom) | `RequestedDeliveryDate` | ↔ | ✅ Fecha logística. Formato OData: `/Date(epoch)/`. Función en §4.3 |
| 72 | `closedate` | — | ✗ | ✅ Queda solo en HubSpot (fecha comercial, no logística) |
| 73 | `condicion_de_pago` (custom) | `CustomerPaymentTerms` | ↔ | `NT30`, `NT60`, etc. |
| 74 | `description` | `to_Text` → `LongText` | → | Concatenar con `dealname` en el mismo texto, o usar `LongTextID="0002"` |
| 75 | `amount` | — | ✗ | SAP calcula monto desde items+pricing. No mapear directamente |
| 76 | `dealstage` | `OverallSDProcessStatus` | ← | Solo SAP→HS. Status SAP es read-only |
| 77 | `pipeline` | — | ✗ | Constante HS `132611721` (Ventas) |
| 78 | `dealtype` | — | ✗ | Solo HubSpot |
| 79 | `hs_priority` | — | ✗ | Sin equivalente SAP |
| 80 | — | `SalesOrderDate` | 🔒 | Fecha actual al crear |
| 81 | 🆕 `sap_salesorder_id` | `SalesOrder` | ← | ID de la orden en SAP |

### 3.2 Items de SalesOrder (`to_Item`)

| # | HubSpot Property | SAP Field | Dir | Notas |
|---|-----------------|-----------|-----|-------|
| 82 | — | `Material` | 🔒 | `"Q01"` |
| 83 | — | `RequestedQuantityUnit` | 🔒 | `"L"` (litros) |
| 84 | `cantidad_producto_comprada` (custom) | `RequestedQuantity` | → | Si existe dato. Default: `"1"` |
| 85 | `dealname` | `SalesOrderItemText` | → | Descripción del ítem |

### 3.3 Partners en SalesOrder (`to_Partner`)

| # | Relación | SAP Field | Notas |
|---|----------|-----------|-------|
| 86 | Deal → Company | `SoldToParty` (header) | Customer# de Company vía `id_map` |
| 87 | Deal → Contact | `to_Partner` con `PartnerFunction='AP'` | ✅ Contact Person. `ContactPerson` = BP# del Contact vía `id_map` |

### 3.4 Timestamps

| HubSpot | SAP | Uso |
|---------|-----|-----|
| `hs_lastmodifieddate` | `LastChangeDateTime` | Last-write-wins. Deals sí tienen `hs_lastmodifieddate` |

---

## 4. Transformaciones del middleware

### 4.1 País (HubSpot texto → SAP ISO alpha-2)

```typescript
const COUNTRY_MAP: Record<string, string> = {
  'Chile': 'CL', 'CL': 'CL', 'Argentina': 'AR', 'AR': 'AR',
  'Perú': 'PE', 'Peru': 'PE', 'PE': 'PE',
  'Colombia': 'CO', 'CO': 'CO', 'Brasil': 'BR', 'Brazil': 'BR', 'BR': 'BR',
  'México': 'MX', 'Mexico': 'MX', 'MX': 'MX',
  'United States': 'US', 'US': 'US', 'España': 'ES', 'Spain': 'ES',
};
// Reverso: SAP→HS se puede dejar como código ISO ya que HubSpot acepta ambos
```

### 4.2 RUT (formato display ↔ dígitos SAP)

```typescript
function formatRutForSap(rut: string): string {
  // "76.123.456-7" → "761234567"
  return rut.replace(/[.\-]/g, '');
}

function formatRutForHubspot(taxNumber: string): string {
  // "761234567" → "76.123.456-7"
  const body = taxNumber.slice(0, -1);
  const dv = taxNumber.slice(-1);
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formatted}-${dv}`;
}
```

### 4.3 Fecha (ISO 8601 ↔ OData v2 epoch)

```typescript
function isoToODataDate(iso: string): string {
  // "2026-06-30T00:00:00.000Z" → "/Date(1751241600000)/"
  return `/Date(${new Date(iso).getTime()})/`;
}

function oDataDateToIso(odataDate: string): string {
  // "/Date(1751241600000)/" → "2026-06-30T00:00:00.000Z"
  const match = odataDate.match(/\/Date\((\d+)\)\//);
  if (!match) throw new Error(`Invalid OData date: ${odataDate}`);
  return new Date(parseInt(match[1])).toISOString();
}
```

### 4.4 Salutation / FormOfAddress

```typescript
const SALUTATION_TO_SAP: Record<string, string> = {
  'Mr.': '0001', 'Sr.': '0001',
  'Mrs.': '0002', 'Ms.': '0002', 'Sra.': '0002',
  'Dr.': '0003',
};

const SAP_TO_SALUTATION: Record<string, string> = {
  '0001': 'Sr.', '0002': 'Sra.', '0003': 'Dr.',
};
```

### 4.5 Región Chile (texto libre → código SAP)

```typescript
const REGION_CL_TO_SAP: Record<string, string> = {
  'Arica y Parinacota': '15', 'Tarapacá': '01', 'Antofagasta': '02',
  'Atacama': '03', 'Coquimbo': '04', 'Valparaíso': '05',
  'Región Metropolitana': 'RM', 'Metropolitana': 'RM', 'Santiago': 'RM',
  "O'Higgins": '06', 'Maule': '07', 'Ñuble': '16', 'Biobío': '08',
  'Araucanía': '09', 'Los Ríos': '14', 'Los Lagos': '10',
  'Aysén': '11', 'Magallanes': '12',
};

const SAP_TO_REGION_CL: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_CL_TO_SAP)
    .filter(([k]) => !['Metropolitana', 'Santiago'].includes(k))
    .map(([k, v]) => [v, k])
);
```

### 4.6 SearchTerm truncation

```typescript
function toSearchTerm(value: string, maxLength = 20): string {
  return value.substring(0, maxLength).toUpperCase();
}
```

---

## 5. Custom Properties a crear en HubSpot

| Objeto | Internal Name | Label | Tipo | Read-only |
|--------|--------------|-------|------|-----------|
| Contact | `sap_bp_id` | SAP Business Partner ID | Single-line text | Sí |
| Contact | `sap_customer_id` | SAP Customer ID | Single-line text | Sí |
| Company | `sap_bp_id` | SAP Business Partner ID | Single-line text | Sí |
| Company | `sap_customer_id` | SAP Customer ID | Single-line text | Sí |
| Deal | `sap_salesorder_id` | SAP Sales Order ID | Single-line text | Sí |

Grupo sugerido: **SAP Integration** (property group en HubSpot).

---

## 6. Acción pendiente antes de codificar

**`to_BuPaIndustry` — Consultar valores disponibles en SAP:**

SAP nota 2834167 confirma que Industry NO se puede establecer vía deep insert en el POST del BP. Requiere POST separado a `to_BuPaIndustry` después de crear el BP.

Se necesita ejecutar en Postman:
```
GET {{SAP_BASE_URL}}/API_BUSINESS_PARTNER/A_BuPaIndustry?$top=50
```
Esto retornará los `IndustrySector` e `IndustrySystemType` configurados en el SAP de Química Sur. Con esa lista podremos construir la tabla de mapeo `HubSpot industry → SAP IndustrySector`.

Para `giro`: irá en `IndustryKeyDescription` (campo texto libre dentro de la misma entidad `A_BuPaIndustry`).

---

## 7. Resumen numérico

| Objeto | Campos sync ↔ | Solo HS→SAP → | Solo SAP→HS ← | Constantes 🔒 | Sin equiv ✗ |
|--------|--------------|---------------|---------------|--------------|-------------|
| Company ↔ BP Org | 8 | 5 | 2 | 9 | 7 |
| Contact ↔ BP Persona | 11 | 3 | 2 | 9 | 4 |
| Deal ↔ SalesOrder | 3 | 5 | 2 | 8 | 5 |
| **Total** | **22** | **13** | **6** | **26** | **16** |

**Total de campos en el mapeo: 87 campos definidos + 5 custom properties nuevas.**
