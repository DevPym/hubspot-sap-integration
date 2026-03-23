# CLAUDE.md — Contexto del proyecto para Claude Code

## Proyecto
- **Nombre:** hubspot-sap-integration (Química Sur)
- **Repo:** https://github.com/DevPym/hubspot-sap-integration
- **Rama:** main
- **Local:** C:\Users\Soporte_PYM\Desktop\QuimicaDelSur

## Stack
- Node.js v24.13.1, TypeScript 5, Express 4, Axios 1, Zod 3
- BullMQ 5, @prisma/client 7, Prisma 7 (dev), dotenv 16
- Vitest 4, Supertest, ESLint 9, Prettier 3, tsx 4, ts-node 10
- Deploy: Railway (PostgreSQL 16 + Redis 7 + Node.js)
- Prisma 5 era incompatible con Node 24 → migrado a Prisma 7

## Scripts
```
dev     = tsx watch src/index.ts
build   = tsc
start   = node dist/index.js
test    = vitest run
lint    = eslint src/**/*.ts
format  = prettier --write src/**/*.ts
```

## Estado actual del repositorio

### Archivos que EXISTEN
```
.gitignore
.prettierrc
.env                          # PORT=3000, NODE_ENV=development, DATABASE_URL (placeholder)
eslint.config.mjs
package.json
prisma.config.ts              # Prisma 7 config, lee DATABASE_URL desde .env
railway.toml                  # Nixpacks build + npm run start
stack.md
tsconfig.json                 # ES2022, CommonJS, strict
vitest.config.ts
src/index.ts                  # Express + GET /health endpoint
tests/health.test.ts          # 1 test pasando
```

### Carpetas que EXISTEN (vacías)
```
src/api/routes/
src/api/middleware/
src/services/
src/adapters/hubspot/
src/adapters/sap/
src/queue/
src/db/repositories/
src/types/
prisma/                       # schema.prisma existe pero VACÍO (sin modelos)
```

### TODO — Archivos por crear (NADA implementado aún)
```
src/config/env.ts                      # Validación Zod de env vars
src/adapters/sap/sap.client.ts         # Basic Auth + CSRF auto + retry 403 + If-Match/ETag
src/adapters/sap/sap.types.ts          # Tipos BP, BPAddress, SalesOrder, SalesOrderItem
src/adapters/hubspot/hubspot.client.ts # Bearer Token + retry 429
src/adapters/hubspot/hubspot.types.ts  # Tipos Contact, Company, Deal
src/api/middleware/auth.middleware.ts   # HMAC-SHA256 verificación webhooks HubSpot
src/api/middleware/error.middleware.ts  # Manejo centralizado de errores
src/api/routes/hubspot.routes.ts       # POST /webhooks/hubspot
src/services/mapper.service.ts         # Transformaciones HubSpot ↔ SAP
src/services/conflict.service.ts       # Last-write-wins por timestamp
src/services/sync.service.ts           # Orquestador principal + anti-bucle
src/queue/sync.queue.ts                # BullMQ cola
src/queue/sync.worker.ts               # Worker que procesa jobs
src/db/prisma.client.ts                # Singleton Prisma
src/db/repositories/idmap.repository.ts
src/db/repositories/synclog.repository.ts
src/types/webhook.schemas.ts           # Zod schemas para payloads webhook
prisma/schema.prisma                   # Tablas id_map, sync_log, retry_job
tests/                                 # Tests para cada módulo nuevo
```

## Arquitectura — Objetos sincronizados (bidireccional)
| HubSpot   | SAP S/4HANA                     | Operaciones      |
|-----------|---------------------------------|------------------|
| Contact   | BusinessPartner (Category=1)    | CREATE, READ, UPDATE |
| Company   | BusinessPartner (Category=2)    | CREATE, READ, UPDATE |
| Deal      | SalesOrder                      | CREATE, READ, UPDATE |

Lead (94 props) y Sales Quotation están fuera de alcance v1.

## APIs Externas

### HubSpot API v3
- Base URL: `https://api.hubapi.com`
- Auth: Bearer Token (Private App). Header: `Authorization: Bearer {HUBSPOT_ACCESS_TOKEN}`
- Webhooks: firma HMAC-SHA256 con `HUBSPOT_CLIENT_SECRET`
- Endpoints: `/crm/v3/objects/contacts`, `/crm/v3/objects/companies`, `/crm/v3/objects/deals`
- PATCH devuelve 200 con body completo del objeto actualizado

### SAP S/4HANA Cloud OData v2
- Base URL: `https://my426851-api.s4hana.cloud.sap/sap/opu/odata/sap`
- Auth: Basic Auth (`CPI_INTEGRATIONS`)
- CSRF: HEAD con `x-csrf-token: fetch` → cachear 25 min → reinyectar en POST/PATCH
- Si 403: invalidar CSRF, refrescar, reintentar una vez
- PATCH requiere header `If-Match` con ETag del recurso. Flujo: GET → extraer ETag → PATCH
- PATCH devuelve 204 sin body
- APIs: `API_BUSINESS_PARTNER/A_BusinessPartner`, `API_SALES_ORDER_SRV/A_SalesOrder`
- $expand NO funciona con $select en OData v2

## Constantes SAP verificadas en producción
```
SalesOrderType       = "OR"
SalesOrganization    = "4601"
DistributionChannel  = "CF"
OrganizationDivision = "10"
Material             = "Q01"
MaterialUnit         = "L"
CompanyCode          = "4610"
BPGrouping           = "BP02"
Roles                = ["FLCU00", "FLCU01"]
PaymentTerms         = "NT30"
ReconciliationAccount = "12120100"
CorrespondenceLanguage = "ES"
BPTaxType            = "CO3"  // RUT Chile
```

## IDs de prueba verificados
```
HubSpot:
  contactId  = 210581802294  (Max Power Test)
  companyId  = 53147869965   (Empresa Test SAP Integration)
  dealId     = 58247306498   (Deal Test SAP Integration)

SAP:
  bpOrgId     = 100000030    (Empresa Test desde HubSpot)
  bpPersonaId = 100000031    (Juan Pérez Test)
  salesOrderId = 49          (DEAL-TEST-HubSpot)
  AddressID persona = 557
  AddressID org     = 554
```

## Pipelines HubSpot Química Sur
```
Licitaciones         = 132611720
Ventas               = 132611721
Otros Negocios       = 766853458
Solicitudes Crédito  = 779098800
```

### Pipeline Ventas — Stages (132611721)
```
EnviarCotizacion       = 229341459
CotizacionEnviada      = 229341460
Negociacion            = 229341461
CotizacionAceptada     = 229341462
PresentacionProgramada = 229341463
ContratoEnviado        = 229226852
CierreGanado           = 229341464  (closed)
Mensualidad            = 229226858  (closed)
CierrePerdido          = 229341465  (closed)
```

## Modelo de datos Prisma (PENDIENTE implementar en schema.prisma)

### id_map
Correspondencia de IDs entre sistemas + bloqueo anti-bucle.
```
id                : UUID PK
entityType        : ENUM (CONTACT, COMPANY, DEAL)
hubspotId         : STRING UNIQUE
sapId             : STRING UNIQUE
syncInProgress    : BOOLEAN
syncInitiatedBy   : ENUM (HUBSPOT, SAP)
syncStartedAt     : TIMESTAMP
createdAt         : TIMESTAMP
updatedAt         : TIMESTAMP
Índices: (entityType, hubspotId) UNIQUE, (entityType, sapId) UNIQUE
```

### sync_log
Auditoría inmutable.
```
id                : UUID PK
idMapId           : UUID FK (nullable)
entityType        : ENUM
operation         : ENUM (CREATE, UPDATE, DELETE)
sourceSystem      : ENUM (HUBSPOT, SAP)
targetSystem      : ENUM
status            : ENUM (PENDING, IN_FLIGHT, SUCCESS, FAILED, SKIPPED)
inboundPayload    : JSON
outboundPayload   : JSON
errorMessage      : STRING
errorCode         : STRING
attemptNumber     : INT
createdAt         : TIMESTAMP
```

### retry_job
Complementa BullMQ con persistencia en PostgreSQL.
```
id                : UUID PK
bullmqJobId       : STRING UNIQUE
payload           : JSON
maxAttempts       : INT (default 5)
attemptCount      : INT
nextRetryAt       : TIMESTAMP
lastError         : STRING
exhausted         : BOOLEAN
createdAt         : TIMESTAMP
updatedAt         : TIMESTAMP
```

## Mecanismo anti-bucle
```
Al iniciar sync:
  SET id_map.syncInProgress = true
  SET id_map.syncInitiatedBy = <sistema fuente>
  SET id_map.syncStartedAt = NOW()

Al recibir webhook con syncInProgress = true:
  IF syncInitiatedBy = sistema OPUESTO AND NOW() - syncStartedAt < 30s
    → Descartar (SKIPPED), return 200

Al completar sync:
  SET syncInProgress = false
  CLEAR syncInitiatedBy, syncStartedAt

Timeout: 30s (SYNC_LOCK_TIMEOUT_MS)
```

## Resolución de conflictos — Last-write-wins
```
1. Recibir evento con T_evento
2. Consultar id_map.updatedAt = T_ultima_sync
3. Si T_evento > T_ultima_sync → proceder
4. Si T_evento <= T_ultima_sync → descartar (SKIPPED)
```

## Mapeo campo a campo

### Contact ↔ BP Persona (Category=1)
```
Constantes CREATE: Category="1", Grouping="BP02", Language="ES",
  Roles=[FLCU00,FLCU01], CustomerCompany{CC=4610,PT=NT30,RA=12120100}
  BusinessPartnerIDByExtSystem = hubspot contactId (max 20ch)

firstname       ↔ FirstName                      (directo)
lastname        ↔ LastName                        (directo)
email           ↔ to_EmailAddress.EmailAddress    (sub-entity Address, POST separado)
phone           ↔ to_PhoneNumber.PhoneNumber      (⚠️ separar código país → DestinationLocationCountry, Type=1)
mobilephone     ↔ to_MobilePhoneNumber.PhoneNumber (Type=3, misma entidad)
fax             ↔ to_FaxNumber.FaxNumber          (baja prioridad v1)
address         ↔ StreetName                      (en to_BusinessPartnerAddress)
city            ↔ CityName
zip             ↔ PostalCode
country         ↔ Country                         (ISO 2-letter)
state           ↔ Region                          (código región SAP)
comuna(custom)  ↔ District
company         ↔ NaturalPersonEmployerName       (max 35ch)
jobtitle        ↔ BusinessPartnerOccupation       (mapeo código)
salutation      ↔ FormOfAddress                   (mapeo código)
industry        ↔ Industry                        (mapeo código)

Timestamp LWW: lastmodifieddate (NO hs_lastmodifieddate) ↔ LastChangeDate+LastChangeTime
```

### Company ↔ BP Organización (Category=2)
```
Constantes CREATE: Category="2", Grouping="BP02", Language="ES" (en Address),
  Roles=[FLCU00,FLCU01], CustomerCompany{CC=4610,PT=NT30,RA=12120100}
  BusinessPartnerIDByExtSystem = hubspot companyId

name            ↔ OrganizationBPName1             (max 40ch)
description     → OrganizationBPName2             (overflow)
phone           ↔ to_PhoneNumber.PhoneNumber
address/city/zip/country/state → mismos campos Address que Contact
comuna(custom)  ↔ District
rut(custom)     ↔ BPTaxNumber (BPTaxType=CO3)
condicion_venta ↔ CustomerCompany.PaymentTerms
industry        ↔ Industry                        (mapeo código)
founded_year    ↔ OrganizationFoundationDate      (año→fecha)
razon_social    ↔ SearchTerm1 (max 20ch) o OrganizationBPName3 (max 40ch)
banco_1/2       ↔ to_BusinessPartnerBank          (sub-entity)

Solo HS (sin sync): domain, numberofemployees, annualrevenue, giro, vendedor,
  monto_credito, representante_legal, contacto_compras, sucursal_1-5

Timestamp LWW: hs_lastmodifieddate ↔ LastChangeDate+LastChangeTime
```

### Deal ↔ SalesOrder
```
Constantes CREATE: SalesOrderType="OR", SalesOrg="4601", DistChannel="CF",
  Division="10", Item: Material="Q01", Unit="L"

dealname                 ↔ PurchaseOrderByCustomer   (max 35ch)
amount                   ← TotalNetAmount            (READ-ONLY SAP, calculado desde items)
closedate                ↔ RequestedDeliveryDate
deal_currency_code       ↔ TransactionCurrency
condicion_de_pago(custom)↔ CustomerPaymentTerms
fecha_de_entrega(custom) ↔ RequestedDeliveryDate
orden_de_compra(custom)  ↔ PurchaseOrderByCustomer   (⚠️ priorizar sobre dealname)
cantidad_producto(custom)↔ to_Item.RequestedQuantity
associatedCompany        → SoldToParty               (⭐ via id_map, Company debe existir primero)
hubspot_owner_id         ↔ to_Partner[ER].Personnel  (mapeo usuarios)
dealstage                ← OverallSDProcessStatus + OverallSDDocumentRejectionSts (mapeo complejo)
pipeline                 — solo HS, sin equivalente SAP

calculo_facturacion (~40 campos custom precio/costo/margen) → fuera de alcance sync v1

Timestamp LWW: hs_lastmodifieddate ↔ LastChangeDateTime (DateTimeOffset)
ETag SalesOrder: W/"datetimeoffset'...'" (diferente formato que BP)
```

## Hallazgos verificados en producción

### SAP
1. Teléfonos: NO incluir código país en PhoneNumber. Usar DestinationLocationCountry. Warning T5/194.
2. Email/Phone/Mobile son sub-entities del Address. Clave compuesta: AddressID+Person+OrdinalNumber.
3. $expand NO funciona con $select en OData v2.
4. LastChangeDate es null hasta el primer PATCH (se popula después).
5. ETag formatos distintos: BP=string plano, SalesOrder=W/"datetimeoffset'...'"
6. TotalNetAmount en SalesOrder es READ-ONLY (calculado desde items).
7. PATCH SAP devuelve 204 sin body.
8. Payload mínimo BP verificado: Category, Grouping, Name, CorrespondenceLanguage, Address(Street,City,Country,Language,PostalCode), Tax(CO3), Roles(FLCU00+FLCU01), CustomerCompany(CC,PT,RA). NO incluir Language en CustomerCompany.
9. BusinessPartnerIDByExtSystem (max 20ch) — campo para guardar HubSpot ID en SAP.

### HubSpot
1. Contact usa `lastmodifieddate` (NO `hs_lastmodifieddate` que viene null en GET list).
2. Company y Deal SÍ usan `hs_lastmodifieddate`.
3. PATCH devuelve 200 con objeto actualizado completo.

## Especificaciones para implementar sap.client.ts
```
- Axios instance con Basic Auth (SAP_USERNAME, SAP_PASSWORD)
- CSRF token: HEAD + x-csrf-token:fetch → cachear 25 min (TTL defensivo < 30 min real)
- Interceptor response: 403 → invalidar CSRF, refrescar, reintentar UNA vez (flag _csrfRetried)
- Método PATCH: GET recurso primero → extraer ETag de response headers → PATCH con If-Match
- ETag BP: response.headers["etag"] string plano
- ETag SalesOrder: response.headers["etag"] formato W/"datetimeoffset'...'"
- Exportar como singleton sapClient
```

## Especificaciones para implementar hubspot.client.ts
```
- Axios instance con Bearer Token (HUBSPOT_ACCESS_TOKEN)
- Interceptor response: 429 → leer Retry-After header → sleep → reintentar (max 3 veces)
- Exportar como singleton hubspotClient
```

## Especificaciones para implementar auth.middleware.ts
```
- Middleware Express para POST /webhooks/hubspot
- Necesita express.raw() ANTES de express.json() en esa ruta específica en index.ts
- Firma v3: HMAC-SHA256(METHOD + URI + BODY + TIMESTAMP) con HUBSPOT_CLIENT_SECRET
- Comparar con header X-HubSpot-Signature-V3 usando timingSafeEqual
- Validar timestamp: rechazar si > 5 min antigüedad (anti-replay)
- Si firma inválida → 401
```

## Variables de entorno requeridas
```
DATABASE_URL              # PostgreSQL (Railway)
REDIS_URL                 # Redis (Railway)
HUBSPOT_ACCESS_TOKEN      # pat-na1-...
HUBSPOT_CLIENT_SECRET     # Para verificar webhooks HMAC
SAP_BASE_URL              # https://my426851-api.s4hana.cloud.sap/sap/opu/odata/sap
SAP_USERNAME              # CPI_INTEGRATIONS
SAP_PASSWORD              # ***
SAP_COMPANY_CODE          # 4610
SAP_BP_GROUPING           # BP02
SAP_CORRESPONDENCE_LANGUAGE # ES
NODE_ENV                  # production | development
PORT                      # 3000
SYNC_LOCK_TIMEOUT_MS      # 30000
MAX_RETRY_ATTEMPTS        # 5
```

## Orden de desarrollo
```
Fase 1: config/env.ts + types (HS + SAP) + Zod schemas + Schema Prisma
Fase 2: Railway setup (PostgreSQL + Redis + deploy) → URL pública
Fase 3: sap.client.ts + hubspot.client.ts + auth.middleware.ts + tests
Fase 4: Prisma migrate + prisma.client.ts + repositories
Fase 5: mapper.service.ts + conflict.service.ts + sync.service.ts
Fase 6: BullMQ queue + worker
Fase 7: Routes + index.ts completo + error.middleware.ts
Fase 8: Webhook config HubSpot (apuntar a URL Railway)
Fase 9: SAP→HubSpot poller (cron/interval por LastChangeDate)
```