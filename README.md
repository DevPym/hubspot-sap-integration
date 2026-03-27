# hubspot-sap-integration — Química Sur

> Sincronización bidireccional en tiempo real entre HubSpot CRM y SAP S/4HANA Cloud.
>
> Real-time bidirectional synchronization between HubSpot CRM and SAP S/4HANA Cloud.

---

## Tabla de Contenidos / Table of Contents

- [Español](#español)
  - [Descripción General](#descripción-general)
  - [Stack Tecnológico](#stack-tecnológico)
  - [Arquitectura del Sistema](#arquitectura-del-sistema)
  - [Estructura del Proyecto](#estructura-del-proyecto)
  - [Modelo de Datos](#modelo-de-datos)
  - [Entidades Sincronizadas](#entidades-sincronizadas)
  - [Mapeo de Campos](#mapeo-de-campos)
  - [Flujo de Sincronización](#flujo-de-sincronización)
  - [Mecanismo Anti-Bucle](#mecanismo-anti-bucle)
  - [Resolución de Conflictos](#resolución-de-conflictos-last-write-wins)
  - [Adaptadores de APIs](#adaptadores-de-apis-externas)
  - [Cola de Trabajos](#cola-de-trabajos-bullmq)
  - [Rutas y Middleware](#rutas-y-middleware)
  - [Servicios](#servicios)
  - [Base de Datos y Repositorios](#base-de-datos-y-repositorios)
  - [Tests](#tests)
  - [Variables de Entorno](#variables-de-entorno)
  - [Scripts Disponibles](#scripts-disponibles)
  - [Configuración y Herramientas](#configuración-y-herramientas)
  - [Despliegue](#despliegue)
  - [Constantes SAP de Producción](#constantes-sap-de-producción)
  - [Hallazgos de Producción](#hallazgos-verificados-en-producción)
- [English](#english)
  - [Overview](#overview)
  - [Technology Stack](#technology-stack)
  - [System Architecture](#system-architecture)
  - [Project Structure](#project-structure)
  - [Data Model](#data-model)
  - [Synchronized Entities](#synchronized-entities)
  - [Field Mapping](#field-mapping)
  - [Synchronization Flow](#synchronization-flow)
  - [Anti-Loop Mechanism](#anti-loop-mechanism)
  - [Conflict Resolution](#conflict-resolution-last-write-wins)
  - [External API Adapters](#external-api-adapters)
  - [Job Queue](#job-queue-bullmq)
  - [Routes and Middleware](#routes-and-middleware)
  - [Services](#services-1)
  - [Database and Repositories](#database-and-repositories)
  - [Tests](#tests-1)
  - [Environment Variables](#environment-variables)
  - [Available Scripts](#available-scripts)
  - [Configuration and Tooling](#configuration-and-tooling)
  - [Deployment](#deployment)
  - [SAP Production Constants](#sap-production-constants)
  - [Production Findings](#verified-production-findings)

---

# Español

## Descripción General

**hubspot-sap-integration** es un servicio backend que sincroniza de forma bidireccional tres entidades de negocio entre **HubSpot CRM** (plataforma de gestión comercial) y **SAP S/4HANA Cloud** (ERP empresarial) para **Química Sur**, empresa del sector químico en Chile.

### Problema que Resuelve

Química Sur opera su gestión comercial en HubSpot y su gestión operativa/financiera en SAP. Sin esta integración, los equipos deben duplicar manualmente la información de clientes, empresas y negocios en ambos sistemas, lo que genera:

- **Datos inconsistentes** entre sistemas.
- **Pérdida de tiempo** en ingreso manual duplicado.
- **Errores humanos** en la transcripción de datos.
- **Falta de trazabilidad** sobre quién modificó qué y cuándo.

### Solución

El sistema escucha webhooks de HubSpot y realiza polling periódico a SAP, propagando cambios de forma automática en ambas direcciones. Implementa:

- **Anti-bucle** para evitar loops infinitos de sincronización.
- **Last-Write-Wins (LWW)** para resolver conflictos de escritura concurrente.
- **Cola persistente** (BullMQ + Redis) con reintentos exponenciales.
- **Auditoría completa** de cada operación de sincronización.
- **Correspondencia de IDs** entre los dos sistemas.

### Alcance v1

| Entidad HubSpot | Entidad SAP                      | Operaciones          |
|-----------------|----------------------------------|----------------------|
| Contact         | BusinessPartner (Category=1)     | CREATE, READ, UPDATE |
| Company         | BusinessPartner (Category=2)     | CREATE, READ, UPDATE |
| Deal            | SalesOrder                       | CREATE, READ, UPDATE |

**Fuera de alcance v1:** Lead (94 propiedades), Sales Quotation, DELETE bidireccional, campos de cálculo de facturación (~40 campos custom).

---

## Stack Tecnológico

### Runtime y Lenguaje

| Tecnología    | Versión | Propósito                                  |
|---------------|---------|-------------------------------------------|
| Node.js       | 24.13.1 | Runtime JavaScript del servidor            |
| TypeScript    | 5       | Tipado estático, seguridad en tiempo de compilación |

### Framework y Librerías Principales

| Librería       | Versión | Propósito                                          |
|---------------|---------|---------------------------------------------------|
| Express       | 4       | Framework HTTP para recibir webhooks               |
| Axios         | 1       | Cliente HTTP para llamadas a HubSpot y SAP APIs   |
| Zod           | 3       | Validación de esquemas (env vars, payloads webhook)|
| BullMQ        | 5       | Cola de trabajos con Redis (reintentos, dedup)     |
| @prisma/client| 7       | ORM para PostgreSQL (repositorios, migraciones)    |
| dotenv        | 16      | Carga de variables de entorno desde `.env`         |

### Herramientas de Desarrollo

| Herramienta   | Versión | Propósito                                         |
|---------------|---------|--------------------------------------------------|
| Vitest        | 4       | Framework de testing (307+ tests)                 |
| Supertest     | -       | Testing de endpoints HTTP                         |
| ESLint        | 9       | Linter de código TypeScript                       |
| Prettier      | 3       | Formateador de código                             |
| tsx           | 4       | Ejecución directa de TypeScript con hot-reload    |
| ts-node       | 10      | Ejecución TypeScript para Prisma CLI              |
| Prisma CLI    | 7       | Migraciones y generación de cliente               |

### Infraestructura (Producción)

| Servicio      | Versión/Proveedor | Propósito                              |
|---------------|-------------------|----------------------------------------|
| Railway       | PaaS              | Hosting de la aplicación Node.js       |
| PostgreSQL    | 16                | Base de datos relacional (Railway)     |
| Redis         | 7                 | Backend para BullMQ (Railway)          |
| Nixpacks      | -                 | Build system en Railway                |

### APIs Externas

| API                          | Protocolo  | Autenticación                  |
|------------------------------|-----------|-------------------------------|
| HubSpot CRM API v3           | REST JSON | Bearer Token (Private App)    |
| SAP S/4HANA OData v2         | OData XML | Basic Auth + CSRF Token       |

> **Nota sobre Prisma:** Se migró de Prisma 5 a Prisma 7 por incompatibilidad con Node.js 24.

---

## Arquitectura del Sistema

### Diagrama de Alto Nivel

```
┌──────────────┐    Webhooks     ┌──────────────────────────────┐    OData v2    ┌──────────────┐
│              │  ────────────►  │                              │  ────────────► │              │
│   HubSpot    │                 │   hubspot-sap-integration    │                │  SAP S/4HANA │
│   CRM v3     │  ◄────────────  │         (Node.js)            │  ◄──────────── │    Cloud     │
│              │   REST API      │                              │   Polling 5m   │              │
└──────────────┘                 └──────────┬───────────────────┘                └──────────────┘
                                            │
                                 ┌──────────┼──────────┐
                                 │          │          │
                              ┌──▼──┐   ┌───▼──┐   ┌──▼──┐
                              │ PG  │   │Redis │   │Logs │
                              │ 16  │   │  7   │   │     │
                              └─────┘   └──────┘   └─────┘
```

### Patrón Arquitectónico

El sistema utiliza una arquitectura **orientada a eventos** con los siguientes patrones:

1. **Webhook Consumer:** Recibe eventos de HubSpot, los valida y los encola.
2. **Job Queue (Producer/Consumer):** BullMQ desacopla la recepción del procesamiento.
3. **Worker Serial:** Procesa un job a la vez (concurrency=1) para evitar race conditions con CSRF tokens y ETags de SAP.
4. **Polling Inverso:** Un cron interno consulta SAP cada 5 minutos buscando cambios.
5. **Repository Pattern:** Abstrae el acceso a PostgreSQL mediante repositorios dedicados.
6. **Adapter Pattern:** Encapsula la comunicación con cada API externa en clientes independientes.

### Capas de la Aplicación

```
┌─────────────────────────────────────────────┐
│              Capa de Transporte              │
│   Express + Middleware (auth, error)         │
│   POST /webhooks/hubspot · GET /health       │
├─────────────────────────────────────────────┤
│              Capa de Cola                     │
│   BullMQ Queue + Worker                      │
│   Deduplicación, reintentos exponenciales    │
├─────────────────────────────────────────────┤
│              Capa de Servicios               │
│   SyncService (orquestador)                  │
│   MapperService (transformaciones)           │
│   ConflictService (LWW)                      │
│   SapPollerService (polling SAP→HS)          │
├─────────────────────────────────────────────┤
│              Capa de Adaptadores             │
│   SapClient (Basic Auth + CSRF + ETag)       │
│   HubSpotClient (Bearer + retry 429)         │
├─────────────────────────────────────────────┤
│              Capa de Persistencia            │
│   Prisma ORM + PostgreSQL                    │
│   Repositories: IdMap, SyncLog, RetryJob     │
└─────────────────────────────────────────────┘
```

---

## Estructura del Proyecto

```
hubspot-sap-integration/
│
├── .env                            # Variables de entorno (NO en repositorio)
├── .env.example                    # Plantilla de variables de entorno
├── .gitignore                      # Archivos excluidos de Git
├── .prettierrc                     # Configuración de Prettier
├── eslint.config.mjs               # Configuración de ESLint 9
├── package.json                    # Dependencias y scripts npm
├── tsconfig.json                   # Configuración TypeScript (ES2022, CommonJS, strict)
├── vitest.config.ts                # Configuración de Vitest (test runner)
├── prisma.config.ts                # Configuración Prisma 7 (lee DATABASE_URL de .env)
├── railway.toml                    # Configuración de deploy en Railway (Nixpacks)
├── CLAUDE.md                       # Contexto del proyecto para Claude Code
├── stack.md                        # Documentación del stack
│
├── prisma/
│   └── schema.prisma               # Esquema de base de datos (3 modelos + 4 enums)
│
├── src/
│   ├── index.ts                    # Punto de entrada: Express app, /health, graceful shutdown
│   │
│   ├── config/
│   │   ├── env.ts                  # Singleton de configuración validada
│   │   └── env.schema.ts           # Esquema Zod con 40+ variables de entorno
│   │
│   ├── adapters/
│   │   ├── sap/
│   │   │   ├── sap.client.ts       # Cliente Axios para SAP OData v2
│   │   │   └── sap.types.ts        # Interfaces TypeScript de entidades SAP
│   │   │
│   │   └── hubspot/
│   │       ├── hubspot.client.ts    # Cliente Axios para HubSpot API v3
│   │       └── hubspot.types.ts     # Interfaces TypeScript de entidades HubSpot
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   └── hubspot.routes.ts    # Rutas de webhooks (POST /webhooks/hubspot)
│   │   │
│   │   └── middleware/
│   │       ├── auth.middleware.ts    # Verificación HMAC-SHA256 de webhooks HubSpot
│   │       └── error.middleware.ts   # Manejo centralizado de errores (Axios, Zod, genérico)
│   │
│   ├── services/
│   │   ├── sync.service.ts          # Orquestador principal de sincronización
│   │   ├── mapper.service.ts        # Transformaciones de datos HubSpot ↔ SAP
│   │   ├── conflict.service.ts      # Resolución Last-Write-Wins por timestamps
│   │   └── sap-poller.service.ts    # Poller SAP → HubSpot (cada 5 minutos)
│   │
│   ├── queue/
│   │   ├── sync.queue.ts            # Cola BullMQ (deduplicación por jobId)
│   │   └── sync.worker.ts           # Worker BullMQ (concurrency=1, rate limit)
│   │
│   ├── db/
│   │   ├── prisma.client.ts         # Singleton PrismaClient
│   │   └── repositories/
│   │       ├── idmap.repository.ts       # CRUD + sync locks para id_map
│   │       ├── synclog.repository.ts     # Auditoría inmutable
│   │       └── retryjob.repository.ts    # Persistencia de jobs fallidos
│   │
│   └── types/
│       └── webhook.schemas.ts       # Esquemas Zod para payloads de webhooks
│
└── tests/                           # 24 archivos de test, 307+ tests
    ├── health.test.ts
    ├── env.test.ts
    ├── auth.middleware.test.ts
    ├── error.middleware.test.ts
    ├── hubspot.client.test.ts
    ├── sap.client.test.ts
    ├── hubspot.routes.test.ts
    ├── hubspot.routes-extended.test.ts
    ├── sync.service.test.ts
    ├── sync.service-extended.test.ts
    ├── mapper.service.test.ts
    ├── mapper.service-extended.test.ts
    ├── conflict.service.test.ts
    ├── sap-poller.service.test.ts
    ├── sap-poller-extended.test.ts
    ├── sync.queue.test.ts
    ├── sync.worker.test.ts
    ├── sync.worker-extended.test.ts
    ├── idmap.repository.test.ts
    ├── synclog.repository.test.ts
    ├── retryjob.repository.test.ts
    ├── prisma.client.test.ts
    └── webhook.schemas.test.ts
```

### Descripción de Cada Archivo

#### Raíz

| Archivo            | Descripción                                                              |
|--------------------|--------------------------------------------------------------------------|
| `package.json`     | Define dependencias, scripts npm, nombre y versión del proyecto          |
| `tsconfig.json`    | Compilador TS: target ES2022, módulos CommonJS, modo estricto habilitado |
| `vitest.config.ts` | Test runner: entorno Node, globals habilitados, include `tests/**/*.test.ts` |
| `prisma.config.ts` | Configuración Prisma 7: lee `DATABASE_URL` desde `.env`                  |
| `eslint.config.mjs`| ESLint 9 flat config para TypeScript                                     |
| `.prettierrc`      | Formateo: semicolons, comillas simples, trailing commas, 100 cols        |
| `railway.toml`     | Deploy: build con Nixpacks, start con `npm run start`                    |

#### `src/index.ts` — Punto de Entrada

Crea la aplicación Express con:
- **Trust proxy** habilitado (Railway usa proxy inverso).
- **`express.raw()`** en `/webhooks/hubspot` (necesario para verificar firma HMAC).
- **`express.json()`** para el resto de rutas.
- Ruta **GET `/health`** que retorna `{ status: "ok", timestamp, uptime }`.
- Montaje de rutas de webhook y middleware de error.
- Arranque de **SapPoller** y **SyncWorker**.
- **Graceful shutdown:** cierra worker, queue, poller y servidor al recibir SIGTERM/SIGINT.

#### `src/config/` — Configuración

- **`env.schema.ts`**: Esquema Zod que define y valida 40+ variables de entorno con tipos, valores por defecto y transformaciones (ej: `SAP_BP_ROLES` es un string que se transforma a array).
- **`env.ts`**: Singleton que exporta la configuración validada. Si falla la validación, imprime errores formateados y termina el proceso con `process.exit(1)`.

#### `src/adapters/sap/` — Cliente SAP

- **`sap.client.ts`** (323 líneas): Cliente Axios singleton con:
  - **Basic Auth**: `Authorization: Basic base64(user:pass)`.
  - **CSRF Token**: Request HEAD con `x-csrf-token: fetch`, cacheado 25 minutos.
  - **Interceptor 403**: Invalida CSRF, refresca y reintenta una vez (flag `_csrfRetried`).
  - **`patchWithETag(url, data)`**: GET recurso → extraer ETag del header → PATCH con `If-Match`.
  - Timeout: 30 segundos.

- **`sap.types.ts`**: Interfaces TypeScript para entidades OData v2:
  - `SapBusinessPartner` (Category 1=persona, 2=organización).
  - `SapBPAddress`, `SapBPPhone`, `SapBPEmail`, `SapBPTaxNumber`.
  - `SapBPRole`, `SapCustomerCompany`, `SapCustomerSalesArea`, `SapBPBank`.
  - `SapSalesOrder`, `SapSalesOrderItem`.
  - Wrappers: `ODataResponse<T>`, `ODataListResponse<T>`.
  - Tipos de creación/actualización con `Omit<>` para excluir campos READ-ONLY.

#### `src/adapters/hubspot/` — Cliente HubSpot

- **`hubspot.client.ts`** (234 líneas): Cliente Axios singleton con:
  - **Bearer Token**: `Authorization: Bearer {token}`.
  - **Retry 429**: Lee header `Retry-After`, espera y reintenta hasta 3 veces.
  - Timeout: 15 segundos.

- **`hubspot.types.ts`**: Interfaces TypeScript para entidades HubSpot v3:
  - `HubSpotContactProperties` (30+ campos, incluye custom: `comuna`, `id_sap`).
  - `HubSpotCompanyProperties` (25+ campos, incluye custom: `rut_empresa`, `condicion_venta`, `razon_social`, `id_sap`).
  - `HubSpotDealProperties` (20+ campos, incluye custom: `condicion_de_pago`, `orden_de_compra_o_contratoo`, `id_sap`).
  - Wrappers: `HubSpotObjectResponse<T>`, `HubSpotListResponse<T>`, `HubSpotUpdatePayload<T>`.

#### `src/api/middleware/` — Middleware

- **`auth.middleware.ts`**: Middleware Express que verifica la firma HMAC-SHA256 v3 de webhooks HubSpot:
  1. Extrae headers `X-HubSpot-Signature-v3` y `X-HubSpot-Request-Timestamp`.
  2. Anti-replay: rechaza si timestamp > 5 minutos de antigüedad.
  3. Reconstruye `sourceString = METHOD + URL + BODY + TIMESTAMP`.
  4. Calcula `HMAC-SHA256(sourceString, CLIENT_SECRET)` en Base64.
  5. Compara con `crypto.timingSafeEqual` (previene ataques de timing).
  6. Retorna 401 si la firma es inválida.

- **`error.middleware.ts`**: Handler centralizado de errores (4 parámetros Express):
  - **AxiosError**: Retorna 502 con detalles del error de la API externa.
  - **ZodError**: Retorna 422 con detalles de validación.
  - **Error genérico**: Retorna 500.
  - En desarrollo: incluye stack traces. En producción: mensajes genéricos por seguridad.

#### `src/api/routes/` — Rutas

- **`hubspot.routes.ts`**: Define `POST /webhooks/hubspot`:
  1. Middleware `verifyHubSpotSignature` valida la firma.
  2. Parsea el body (Buffer → JSON).
  3. Valida con `webhookPayloadSchema` (Zod).
  4. Clasifica cada evento: Contact, Company, Deal, deletion, merge, restore, associationChange.
  5. Manejo especial de `associationChange` (Deal↔Company): usa `fromObjectId`/`toObjectId`.
  6. Encola con `addSyncJob()` (deduplicación por jobId).
  7. Retorna 200 inmediatamente (procesamiento asíncrono).

#### `src/services/` — Servicios de Negocio

- **`sync.service.ts`** (716 líneas): Orquestador principal:
  1. Determina CREATE vs UPDATE consultando `id_map`.
  2. Verifica anti-bucle: si `syncInProgress=true` y mismo sistema dentro del timeout → SKIPPED.
  3. Verifica LWW: si event timestamp ≤ `updatedAt` → SKIPPED.
  4. Lee objeto completo desde HubSpot.
  5. Para Deal: `resolveCompanyForDeal()` verifica que la Company asociada exista en id_map.
  6. Si falta la Company, lanza `MissingDependencyError` (retriable, BullMQ reintenta).
  7. Transforma con mapper.
  8. Crea/actualiza en SAP.
  9. Registra en sync_log.
  10. Retorna `SyncResult { success, operation, entityType, hubspotId, sapId }`.

- **`mapper.service.ts`** (12.8k+ tokens): Transformaciones puras sin efectos secundarios:
  - `createContactPayload()`: HubSpot Contact → SAP BP Create.
  - `updateContactPayload()`: HubSpot Contact → SAP BP Update.
  - `sapBPToContactUpdate()`: SAP BP → HubSpot Contact.
  - `createCompanyPayload()`: HubSpot Company → SAP BP Create.
  - `updateCompanyPayload()`: HubSpot Company → SAP BP Update.
  - `sapBPToCompanyUpdate()`: SAP BP → HubSpot Company.
  - `createDealPayload()`: HubSpot Deal → SAP SalesOrder Create.
  - `updateDealPayload()`: HubSpot Deal → SAP SalesOrder Update.
  - `salesOrderToDealUpdate()`: SAP SalesOrder → HubSpot Deal.
  - Helpers: `sapDateTimeToMs()`, `sapDateTimeOffsetToMs()`, `COUNTRY_MAP`, `MAX_LENGTHS`.

- **`conflict.service.ts`** (215 líneas): Resolución Last-Write-Wins:
  - `evaluateHubSpotEvent()`: Compara timestamp del evento vs última sincronización.
  - `evaluateSapBPEvent()`: Parsea `LastChangeDate + LastChangeTime` de SAP.
  - `evaluateSapSOEvent()`: Parsea `LastChangeDateTime` (DateTimeOffset) de SalesOrder.
  - Primer sync (sin registro previo): siempre proceder.
  - Maneja null timestamps (hallazgo producción).

- **`sap-poller.service.ts`** (672 líneas): Polling SAP → HubSpot cada 5 minutos:
  - `pollBusinessPartners()`: Filtra por `LastChangeDate ge {timestamp}`.
  - `pollSalesOrders()`: Filtra por `LastChangeDateTime ge {timestamp}`.
  - `syncBPToHubSpot(bp)`: Anti-bucle + hash dedup + mapper + PATCH HubSpot.
  - `syncSalesOrderToHubSpot(so)`: Similar a BP para Deals.
  - Sincronización de asociaciones: Deal↔Company y Contact↔Company.
  - Hash dedup con MD5: evita actualizaciones cuando los datos no cambiaron realmente.
  - Manejo de email duplicado: reintenta sin email si HubSpot rechaza.
  - `startSapPoller()` / `stopSapPoller()`: Control del intervalo.

#### `src/queue/` — Cola de Trabajos

- **`sync.queue.ts`**: Cola BullMQ `hubspot-sap-sync`:
  - Parsea `REDIS_URL` para extraer host/port/password/username.
  - Default job options: `attempts = MAX_RETRY_ATTEMPTS`, backoff exponencial (1s base).
  - `removeOnComplete: { count: 1000 }`, `removeOnFail: { count: 5000 }`.
  - `addSyncJob(event)`: Genera jobId = `{entityType}-{objectId}-{occurredAt}` (deduplicación).

- **`sync.worker.ts`** (232 líneas): Worker BullMQ:
  - Concurrency = 1 (procesamiento serial, previene race conditions CSRF/ETag).
  - Rate limiter: 10 jobs / 60 segundos.
  - `processJob(job)`: Invoca `syncHubSpotToSap(event)`.
  - Event handler `failed`: Registra en `retry_job` table con cálculo de backoff.
  - Manejo especial de `MissingDependencyError`: log con contexto adicional.

#### `src/db/` — Persistencia

- **`prisma.client.ts`** (95 líneas): Singleton PrismaClient:
  - En desarrollo: usa `globalThis` para sobrevivir hot-reload de `tsx watch`.
  - En producción: instancia directa.
  - Usa adapter `@prisma/adapter-pg` para conexión.
  - Logging configurable: query+warn+error (dev), solo error (prod).

- **`idmap.repository.ts`** (159 líneas):
  - `findByHubSpotId(entityType, hubspotId)`: Busca por constraint único.
  - `findBySapId(entityType, sapId)`: Busca por constraint único.
  - `create(data)`: Inserta nuevo mapping.
  - `acquireSyncLock(id, initiatedBy)`: Activa lock, marca iniciador y timestamp.
  - `releaseSyncLock(id)`: Desactiva lock, limpia campos.
  - `isSyncLocked(id)`: Retorna `{locked, initiatedBy}`, verifica timeout 30s.

- **`synclog.repository.ts`** (126 líneas): Tabla inmutable (solo INSERT, nunca UPDATE/DELETE):
  - `create(data)`: Inserta registro de auditoría.
  - `findByIdMap(idMapId, limit)`: Historial de una entidad.
  - `findRecent(limit)`: Registros más recientes.

- **`retryjob.repository.ts`** (120 líneas):
  - `create(data)`: Registra job fallido.
  - `updateAttempt(bullmqJobId, error, nextRetryAt)`: Incrementa contador.
  - `markExhausted(bullmqJobId, error)`: Marca como agotado (requiere intervención manual).
  - `findPending(limit)` / `findExhausted(limit)`: Consultas para monitoreo.

#### `src/types/` — Tipos y Esquemas

- **`webhook.schemas.ts`**: Esquemas Zod para webhooks HubSpot:
  - 13 tipos de suscripción: `contact.creation`, `contact.propertyChange`, `deal.associationChange`, etc.
  - Campos: `occurredAt`, `objectId`, `objectTypeId`, `propertyName`, `propertyValue`.
  - Campos de asociación: `fromObjectId`, `toObjectId`, `changeFlag`, `associationType`.
  - Helpers de narrowing: `isContactEvent()`, `isCompanyEvent()`, `isDealEvent()`, `isCreationEvent()`, `isPropertyChangeEvent()`, `isAssociationChangeEvent()`, etc.

---

## Modelo de Datos

### Diagrama Entidad-Relación

```
┌──────────────────────────────────┐
│            id_map                │
├──────────────────────────────────┤
│ id              UUID PK          │
│ entityType      ENUM             │◄──── CONTACT | COMPANY | DEAL
│ hubspotId       STRING UNIQUE    │
│ sapId           STRING UNIQUE    │
│ syncInProgress  BOOLEAN          │◄──── Anti-bucle
│ syncInitiatedBy ENUM nullable    │◄──── HUBSPOT | SAP
│ syncStartedAt   DATETIME nullable│
│ createdAt       DATETIME         │
│ updatedAt       DATETIME         │◄──── Timestamp para LWW
├──────────────────────────────────┤
│ UK: (entityType, hubspotId)      │
│ UK: (entityType, sapId)          │
└────────────┬─────────────────────┘
             │ 1:N
             ▼
┌──────────────────────────────────┐
│           sync_log               │
├──────────────────────────────────┤
│ id              UUID PK          │
│ idMapId         UUID FK nullable │
│ entityType      ENUM             │
│ operation       ENUM             │◄──── CREATE | UPDATE | DELETE
│ sourceSystem    ENUM             │◄──── HUBSPOT | SAP
│ targetSystem    ENUM             │
│ status          ENUM             │◄──── PENDING | IN_FLIGHT | SUCCESS | FAILED | SKIPPED
│ inboundPayload  JSON             │
│ outboundPayload JSON nullable    │
│ errorMessage    STRING nullable  │
│ errorCode       STRING nullable  │
│ attemptNumber   INT              │
│ createdAt       DATETIME         │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│          retry_job               │
├──────────────────────────────────┤
│ id              UUID PK          │
│ bullmqJobId     STRING UNIQUE    │
│ payload         JSON             │
│ maxAttempts     INT (default 5)  │
│ attemptCount    INT              │
│ nextRetryAt     DATETIME         │
│ lastError       STRING nullable  │
│ exhausted       BOOLEAN          │
│ createdAt       DATETIME         │
│ updatedAt       DATETIME         │
└──────────────────────────────────┘
```

### Enums de la Base de Datos

```typescript
enum EntityType   { CONTACT, COMPANY, DEAL }
enum SystemSource { HUBSPOT, SAP }
enum SyncOperation{ CREATE, UPDATE, DELETE }
enum SyncStatus   { PENDING, IN_FLIGHT, SUCCESS, FAILED, SKIPPED }
```

---

## Entidades Sincronizadas

### Contact ↔ BusinessPartner (Persona, Category=1)

Un **Contact** en HubSpot representa a una persona individual. En SAP, se mapea a un **BusinessPartner** con `BusinessPartnerCategory = "1"` (persona natural).

- **Dirección HS→SAP:** Webhook de creación/modificación dispara sync inmediata.
- **Dirección SAP→HS:** Poller cada 5 minutos detecta cambios por `LastChangeDate`.
- **Constantes SAP al crear:** Grouping=BP02, Language=ES, Roles=[FLCU00, FLCU01], CustomerCompany con CompanyCode=4610, PaymentTerms=NT30, ReconciliationAccount=12120100.

### Company ↔ BusinessPartner (Organización, Category=2)

Una **Company** en HubSpot representa a una empresa u organización. En SAP, se mapea a un **BusinessPartner** con `BusinessPartnerCategory = "2"` (organización).

- Similar a Contact pero con campos específicos de organización: `OrganizationBPName1/2/3`, `SearchTerm1`, `BPTaxNumber` (RUT chileno).
- Campos exclusivos de HubSpot (sin sync): domain, numberofemployees, annualrevenue, giro, vendedor, sucursales.

### Deal ↔ SalesOrder

Un **Deal** en HubSpot representa una oportunidad de venta. En SAP, se mapea a un **SalesOrder** (Orden de Venta).

- **Dependencia crítica:** La Company asociada al Deal DEBE existir previamente en id_map. Si no existe, se lanza `MissingDependencyError` y BullMQ reintenta automáticamente.
- **Constantes SAP al crear:** SalesOrderType=OR, SalesOrganization=4601, DistributionChannel=CF, OrganizationDivision=10, Material=Q01, MaterialUnit=L.
- **Campo READ-ONLY:** `amount` en HubSpot ← `TotalNetAmount` en SAP (calculado desde items, no se puede escribir).

---

## Mapeo de Campos

### Contact ↔ BusinessPartner Persona

| HubSpot Campo     | SAP Campo                          | Dirección | Notas                                     |
|-------------------|------------------------------------|-----------|--------------------------------------------|
| `firstname`       | `FirstName`                        | ↔         | Directo                                    |
| `lastname`        | `LastName`                         | ↔         | Directo                                    |
| `email`           | `to_EmailAddress.EmailAddress`     | ↔         | Sub-entity del Address (POST separado)     |
| `phone`           | `to_PhoneNumber.PhoneNumber`       | ↔         | Sin código país, usar DestinationLocationCountry |
| `mobilephone`     | `to_MobilePhoneNumber.PhoneNumber` | ↔         | Type=3 (misma entidad que teléfono)        |
| `fax`             | `to_FaxNumber.FaxNumber`           | →         | Baja prioridad v1                          |
| `address`         | `StreetName`                       | ↔         | En to_BusinessPartnerAddress               |
| `city`            | `CityName`                         | ↔         | En Address                                 |
| `zip`             | `PostalCode`                       | ↔         | En Address                                 |
| `country`         | `Country`                          | ↔         | Texto → ISO 2-letter (COUNTRY_MAP)         |
| `state`           | `Region`                           | ↔         | Código región SAP                          |
| `comuna` (custom) | `District`                         | ↔         | Campo personalizado Química Sur            |
| `company`         | `NaturalPersonEmployerName`        | ↔         | Max 35 caracteres                          |
| `jobtitle`        | `BusinessPartnerOccupation`        | ↔         | Mapeo de código                            |
| `salutation`      | `FormOfAddress`                    | ↔         | Mapeo de código                            |
| `industry`        | `Industry`                         | ↔         | Mapeo de código                            |
| `id_sap` (custom) | `BusinessPartner` (ID)             | ←         | Se escribe en HS al crear en SAP           |

**Timestamp LWW Contact:** `lastmodifieddate` (NO `hs_lastmodifieddate`) ↔ `LastChangeDate + LastChangeTime`

### Company ↔ BusinessPartner Organización

| HubSpot Campo            | SAP Campo                    | Dirección | Notas                              |
|--------------------------|------------------------------|-----------|------------------------------------|
| `name`                   | `OrganizationBPName1`        | ↔         | Max 40 caracteres                  |
| `description`            | `OrganizationBPName2`        | →         | Overflow del nombre                |
| `phone`                  | `to_PhoneNumber.PhoneNumber` | ↔         | Sub-entity Address                 |
| `address/city/zip/state` | Campos Address               | ↔         | Igual que Contact                  |
| `country`                | `Country`                    | ↔         | ISO 2-letter                       |
| `comuna` (custom)        | `District`                   | ↔         | Campo personalizado                |
| `rut_empresa` (custom)   | `BPTaxNumber`                | ↔         | BPTaxType=CO3 (RUT Chile)          |
| `condicion_venta` (custom)| `CustomerCompany.PaymentTerms`| ↔        | Condición de pago                  |
| `razon_social` (custom)  | `SearchTerm1` / `BPName3`    | →         | Max 20ch / 40ch                    |
| `industry`               | `Industry`                   | ↔         | Mapeo de código                    |
| `founded_year`           | `OrganizationFoundationDate` | ↔         | Año → fecha completa               |
| `id_sap` (custom)        | `BusinessPartner` (ID)       | ←         | Se escribe en HS al crear en SAP   |

**Timestamp LWW Company:** `hs_lastmodifieddate` ↔ `LastChangeDate + LastChangeTime`

### Deal ↔ SalesOrder

| HubSpot Campo                        | SAP Campo                      | Dirección | Notas                                   |
|--------------------------------------|--------------------------------|-----------|-----------------------------------------|
| `dealname`                           | `PurchaseOrderByCustomer`      | ↔         | Max 35 caracteres                       |
| `amount`                             | `TotalNetAmount`               | ←         | READ-ONLY (calculado desde items en SAP)|
| `closedate`                          | `RequestedDeliveryDate`        | ↔         | Fecha de entrega solicitada             |
| `deal_currency_code`                 | `TransactionCurrency`          | ↔         | Código moneda ISO                       |
| `condicion_de_pago` (custom)         | `CustomerPaymentTerms`         | ↔         | Condición de pago                       |
| `fecha_de_entrega` (custom)          | `RequestedDeliveryDate`        | ↔         | Prioridad sobre closedate               |
| `orden_de_compra_o_contratoo` (custom)| `PurchaseOrderByCustomer`     | →         | Prioridad sobre dealname                |
| `cuanto_es_la_cantidad_...` (custom) | `to_Item.RequestedQuantity`    | ↔         | Cantidad del producto                   |
| Company asociada                     | `SoldToParty`                  | →         | Via id_map (Company debe existir)       |
| `hubspot_owner_id`                   | `to_Partner[ER].Personnel`     | ↔         | Mapeo de usuarios                       |
| `dealstage`                          | `OverallSDProcessStatus`       | ←         | Mapeo complejo de estados               |
| `pipeline`                           | —                              | —         | Solo HubSpot, sin equivalente SAP       |
| `id_sap` (custom)                    | `SalesOrder` (ID)              | ←         | Se escribe en HS al crear en SAP        |

**Timestamp LWW Deal:** `hs_lastmodifieddate` ↔ `LastChangeDateTime` (DateTimeOffset)

---

## Flujo de Sincronización

### HubSpot → SAP (Webhook-driven)

```
1. HubSpot dispara webhook POST /webhooks/hubspot
       │
2. auth.middleware verifica firma HMAC-SHA256 v3
       │
3. Payload se valida con Zod (webhookPayloadSchema)
       │
4. Cada evento se clasifica (Contact/Company/Deal)
       │
5. addSyncJob() encola en BullMQ (dedup por jobId)
       │
6. Retorna 200 OK inmediatamente
       │
7. Worker toma el job (concurrency=1)
       │
8. syncHubSpotToSap(event):
       │
       ├── ¿Existe en id_map? → Sí: UPDATE, No: CREATE
       │
       ├── ¿Lock activo del sistema opuesto dentro de 30s?
       │   └── Sí → SKIPPED (anti-bucle)
       │
       ├── ¿Timestamp evento > última sync?
       │   └── No → SKIPPED (LWW)
       │
       ├── Lee objeto completo de HubSpot
       │
       ├── [Solo Deal] ¿Company existe en id_map?
       │   └── No → MissingDependencyError (reintento)
       │
       ├── Mapper transforma HS → SAP payload
       │
       ├── POST (create) o patchWithETag (update) a SAP
       │
       ├── Crea/actualiza id_map + registra sync_log
       │
       └── Retorna SyncResult { success: true }
```

### SAP → HubSpot (Polling cada 5 minutos)

```
1. setInterval cada 5 minutos (SAP_POLL_INTERVAL_MS)
       │
2. pollBusinessPartners():
       │   GET /API_BUSINESS_PARTNER/A_BusinessPartner
       │   $filter=LastChangeDate ge '{timestamp}'
       │
       ├── Para cada BP modificado:
       │   ├── ¿Existe en id_map? → No: ignorar
       │   ├── ¿Lock activo de HS dentro de 30s? → SKIP
       │   ├── ¿Hash de datos cambió? → No: SKIP (dedup)
       │   ├── Lee address completo del BP
       │   ├── Mapper transforma SAP → HS payload
       │   ├── PATCH en HubSpot
       │   ├── Sincroniza asociaciones (Contact↔Company)
       │   └── Registra sync_log
       │
3. pollSalesOrders():
       │   GET /API_SALES_ORDER_SRV/A_SalesOrder
       │   $filter=LastChangeDateTime ge datetimeoffset'{timestamp}'
       │
       └── Similar a BPs pero para Deals
              └── Sincroniza asociación Deal↔Company
```

---

## Mecanismo Anti-Bucle

### Problema

Cuando el sistema sincroniza un Contact de HubSpot a SAP, la modificación en SAP podría ser detectada por el poller, generando una sincronización de vuelta a HubSpot, que a su vez generaría otro webhook... creando un **loop infinito**.

### Solución

Se utiliza un sistema de **locks temporales** en la tabla `id_map`:

```
┌─────────┐     Webhook        ┌────────────┐   PATCH    ┌─────────┐
│ HubSpot │ ──────────────────►│ Integration│──────────► │   SAP   │
│         │                    │   Server   │            │         │
└─────────┘                    └──────┬─────┘            └────┬────┘
                                     │                        │
                              ┌──────▼─────┐                  │
                              │  id_map    │                  │
                              │ locked=true│                  │
                              │ by=HUBSPOT │                  │
                              └──────┬─────┘                  │
                                     │                        │
                                     │  Poller detecta cambio │
                                     │◄───────────────────────┘
                                     │
                              ¿locked=true AND by=HUBSPOT?
                                     │
                                   [SÍ] → SKIP (no sincronizar de vuelta)
                                     │
                              [30s después]
                              locked=false → Normal
```

### Campos en `id_map`

| Campo            | Tipo     | Descripción                                   |
|------------------|----------|-----------------------------------------------|
| `syncInProgress` | BOOLEAN  | `true` mientras una sync está en curso         |
| `syncInitiatedBy`| ENUM     | Quién inició: `HUBSPOT` o `SAP`               |
| `syncStartedAt`  | DATETIME | Cuándo se activó el lock                       |

### Reglas

1. **Activar lock:** Antes de escribir en el sistema destino.
2. **Verificar lock:** Al recibir un evento, si `locked=true` Y el iniciador es el sistema **opuesto** Y han pasado menos de 30 segundos → SKIP.
3. **Liberar lock:** Al completar la sincronización.
4. **Timeout:** Si han pasado más de 30 segundos, el lock se considera expirado (la sync probablemente falló).

---

## Resolución de Conflictos (Last-Write-Wins)

### Problema

Si un usuario modifica un Contact en HubSpot y otro usuario modifica el mismo Contact en SAP casi simultáneamente, ¿cuál cambio prevalece?

### Solución

**Last-Write-Wins (LWW):** El cambio más reciente por timestamp siempre gana.

```
Evento llega con T_evento
       │
       ▼
¿Existe id_map para esta entidad?
       │
       ├── No → Primer sync, PROCEDER
       │
       └── Sí → Comparar T_evento vs id_map.updatedAt
                │
                ├── T_evento > updatedAt → PROCEDER (cambio más reciente)
                │
                └── T_evento ≤ updatedAt → SKIP (cambio obsoleto)
```

### Timestamps por Entidad

| Entidad          | Campo HubSpot             | Campo SAP                          |
|-----------------|---------------------------|------------------------------------|
| Contact         | `lastmodifieddate`        | `LastChangeDate + LastChangeTime`  |
| Company         | `hs_lastmodifieddate`     | `LastChangeDate + LastChangeTime`  |
| Deal            | `hs_lastmodifieddate`     | `LastChangeDateTime`               |

> **Nota crítica:** Contact usa `lastmodifieddate` (SIN prefijo `hs_`), porque `hs_lastmodifieddate` viene `null` en GET list de la API v3. Esto fue un hallazgo verificado en producción.

---

## Adaptadores de APIs Externas

### SAP S/4HANA OData v2

| Característica     | Detalle                                                     |
|-------------------|-------------------------------------------------------------|
| **Base URL**      | `https://my426851-api.s4hana.cloud.sap/sap/opu/odata/sap`  |
| **Auth**          | Basic Auth (usuario: `CPI_INTEGRATIONS`)                    |
| **CSRF**          | HEAD con `x-csrf-token: fetch`, cache 25 min                |
| **Retry 403**     | Invalida CSRF → refresca → reintenta 1 vez                 |
| **PATCH**         | Requiere GET previo para obtener ETag + header `If-Match`   |
| **Response PATCH**| 204 sin body                                                |
| **Timeout**       | 30 segundos                                                 |
| **Limitación**    | `$expand` NO funciona con `$select`                         |

**APIs utilizadas:**
- `API_BUSINESS_PARTNER/A_BusinessPartner` — Contactos y Empresas
- `API_SALES_ORDER_SRV/A_SalesOrder` — Órdenes de Venta

### HubSpot CRM API v3

| Característica     | Detalle                                              |
|-------------------|------------------------------------------------------|
| **Base URL**      | `https://api.hubapi.com`                              |
| **Auth**          | Bearer Token (Private App)                            |
| **Retry 429**     | Lee `Retry-After`, espera y reintenta (max 3 veces)  |
| **Response PATCH**| 200 con body completo del objeto actualizado          |
| **Timeout**       | 15 segundos                                           |
| **Webhooks**      | Firma HMAC-SHA256 v3 con `CLIENT_SECRET`             |

**Endpoints utilizados:**
- `/crm/v3/objects/contacts` — Contactos
- `/crm/v3/objects/companies` — Empresas
- `/crm/v3/objects/deals` — Negocios
- `/crm/v3/objects/{type}/{id}/associations/{toType}` — Asociaciones
- `/crm/v4/objects/{type}/{id}/associations/{toType}` — Asociaciones v4

---

## Cola de Trabajos (BullMQ)

### Configuración

| Parámetro            | Valor                                          |
|---------------------|------------------------------------------------|
| Nombre de cola      | `hubspot-sap-sync`                              |
| Backend             | Redis 7 (Railway)                               |
| Concurrency         | 1 (serial, previene race conditions)            |
| Rate limit          | 10 jobs / 60 segundos                           |
| Max intentos        | `MAX_RETRY_ATTEMPTS` (default: 5)               |
| Backoff             | Exponencial, base 1 segundo                     |
| Limpieza completados| Mantiene últimos 1,000                          |
| Limpieza fallidos   | Mantiene últimos 5,000                          |

### Deduplicación

Cada job tiene un ID único generado como `{entityType}-{objectId}-{occurredAt}`, lo que previene que el mismo evento sea procesado dos veces si HubSpot envía webhooks duplicados.

### Persistencia de Fallos

Cuando un job falla definitivamente (agotó reintentos), se registra en la tabla `retry_job` de PostgreSQL para:
- Diagnóstico manual del error.
- Posible reprocesamiento futuro.
- Métricas de confiabilidad.

---

## Rutas y Middleware

### Endpoints

| Método | Ruta                  | Middleware            | Descripción                         |
|--------|-----------------------|-----------------------|-------------------------------------|
| GET    | `/health`             | Ninguno               | Health check: `{ status, timestamp, uptime }` |
| POST   | `/webhooks/hubspot`   | `verifyHubSpotSignature` | Recibe webhooks de HubSpot        |

### Seguridad del Webhook

1. **express.raw()** procesa el body como Buffer (necesario para calcular HMAC).
2. **Anti-replay:** Rechaza requests con timestamp > 5 minutos.
3. **HMAC-SHA256 v3:** `hash = HMAC(METHOD + URL + BODY + TIMESTAMP, SECRET)`.
4. **timingSafeEqual:** Comparación en tiempo constante (previene timing attacks).

---

## Servicios

### SyncService (Orquestador)

Responsabilidad: coordinar todo el flujo de sincronización HubSpot → SAP.

| Función                    | Responsabilidad                                      |
|---------------------------|------------------------------------------------------|
| `syncHubSpotToSap(event)` | Orquesta: lock → read → map → write → log → unlock  |
| `resolveCompanyForDeal()`  | Verifica que Company exista antes de crear SalesOrder |

### MapperService (Transformador)

Responsabilidad: funciones puras que transforman datos entre formatos.

| Función                    | Entrada → Salida                          |
|---------------------------|-------------------------------------------|
| `createContactPayload()`  | HS Contact → SAP BP Create payload        |
| `updateContactPayload()`  | HS Contact → SAP BP Update payload        |
| `sapBPToContactUpdate()`  | SAP BP → HS Contact properties            |
| `createCompanyPayload()`  | HS Company → SAP BP Create payload        |
| `updateCompanyPayload()`  | HS Company → SAP BP Update payload        |
| `sapBPToCompanyUpdate()`  | SAP BP → HS Company properties            |
| `createDealPayload()`     | HS Deal → SAP SO Create payload           |
| `updateDealPayload()`     | HS Deal → SAP SO Update payload           |
| `salesOrderToDealUpdate()`| SAP SO → HS Deal properties               |

### ConflictService (LWW)

Responsabilidad: determinar si un evento es más reciente que la última sincronización.

| Función                   | Uso                                              |
|--------------------------|--------------------------------------------------|
| `evaluateHubSpotEvent()` | Compara timestamp evento HS vs última sync       |
| `evaluateSapBPEvent()`   | Parsea LastChangeDate+Time de BP                 |
| `evaluateSapSOEvent()`   | Parsea LastChangeDateTime de SalesOrder           |

### SapPollerService (Polling)

Responsabilidad: detectar cambios en SAP y propagar a HubSpot.

| Función                    | Responsabilidad                                     |
|---------------------------|-----------------------------------------------------|
| `startSapPoller()`        | Inicia interval cada 5 min (delay inicial 30s)      |
| `stopSapPoller()`         | Detiene el interval                                  |
| `pollBusinessPartners()`  | Consulta BPs modificados, sincroniza cada uno        |
| `pollSalesOrders()`       | Consulta SOs modificados, sincroniza cada uno        |
| `syncBPToHubSpot(bp)`     | Anti-bucle + hash + map + patch + asociaciones       |
| `syncSalesOrderToHubSpot()`| Similar para Deals                                  |

---

## Base de Datos y Repositorios

### Prisma 7 + PostgreSQL 16

El ORM Prisma maneja las migraciones y el acceso a datos. Se migró de Prisma 5 a Prisma 7 por incompatibilidad con Node.js 24.

### Tablas

| Tabla       | Propósito                                | Operaciones      |
|------------|------------------------------------------|------------------|
| `id_map`   | Correspondencia de IDs HS↔SAP + locks   | CRUD + lock/unlock|
| `sync_log` | Auditoría inmutable de sincronizaciones  | Solo INSERT + READ|
| `retry_job`| Persistencia de jobs fallidos BullMQ     | CRUD              |

---

## Tests

### Resumen

| Métrica          | Valor          |
|-----------------|----------------|
| Framework       | Vitest 4        |
| Total tests     | 307+            |
| Archivos test   | 24              |
| Cobertura       | Todos los módulos |

### Desglose por Módulo

| Archivo de Test                      | Módulo Bajo Test           | Tipo                    |
|--------------------------------------|----------------------------|-------------------------|
| `health.test.ts`                     | GET /health                | Integración (Supertest) |
| `env.test.ts`                        | Validación env vars        | Unitario                |
| `auth.middleware.test.ts`            | HMAC-SHA256 verificación   | Unitario                |
| `error.middleware.test.ts`           | Manejo de errores          | Unitario                |
| `hubspot.client.test.ts`            | Cliente Axios HubSpot      | Unitario (mocks)        |
| `sap.client.test.ts`                | Cliente Axios SAP          | Unitario (mocks)        |
| `hubspot.routes.test.ts`            | Rutas webhook              | Integración             |
| `hubspot.routes-extended.test.ts`    | Rutas webhook (110+ tests) | Integración extendido   |
| `sync.service.test.ts`              | Orquestador sync           | Unitario (mocks)        |
| `sync.service-extended.test.ts`      | Sync con asociaciones      | Unitario extendido      |
| `mapper.service.test.ts`            | Transformaciones datos     | Unitario                |
| `mapper.service-extended.test.ts`    | Mapper (110+ tests)        | Unitario extendido      |
| `conflict.service.test.ts`          | Last-Write-Wins            | Unitario                |
| `sap-poller.service.test.ts`        | Polling SAP→HS             | Unitario (mocks)        |
| `sap-poller-extended.test.ts`        | Poller asociaciones/dedup  | Unitario extendido      |
| `sync.queue.test.ts`                | Cola BullMQ                | Unitario (mocks)        |
| `sync.worker.test.ts`               | Worker BullMQ              | Unitario (mocks)        |
| `sync.worker-extended.test.ts`       | Worker comportamiento      | Unitario extendido      |
| `idmap.repository.test.ts`          | Repository id_map          | Unitario (mocks)        |
| `synclog.repository.test.ts`        | Repository sync_log        | Unitario (mocks)        |
| `retryjob.repository.test.ts`       | Repository retry_job       | Unitario (mocks)        |
| `prisma.client.test.ts`             | Singleton Prisma           | Unitario                |
| `webhook.schemas.test.ts`           | Validación Zod webhooks    | Unitario                |

### Ejecución

```bash
# Ejecutar todos los tests
npm test

# Ejecutar tests con watch mode
npx vitest

# Ejecutar un archivo específico
npx vitest run tests/mapper.service.test.ts
```

---

## Variables de Entorno

### Archivo `.env`

```env
# ─── Base de datos ───
DATABASE_URL=postgresql://user:pass@host:5432/db

# ─── Redis (BullMQ) ───
REDIS_URL=redis://default:pass@host:6379

# ─── HubSpot ───
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxx
HUBSPOT_CLIENT_SECRET=xxxx              # Para verificar firma webhooks

# ─── SAP S/4HANA ───
SAP_BASE_URL=https://my426851-api.s4hana.cloud.sap/sap/opu/odata/sap
SAP_USERNAME=CPI_INTEGRATIONS
SAP_PASSWORD=xxxx

# ─── Constantes SAP ───
SAP_COMPANY_CODE=4610
SAP_BP_GROUPING=BP02
SAP_CORRESPONDENCE_LANGUAGE=ES
SAP_BP_ROLES=FLCU00,FLCU01
SAP_DEFAULT_PAYMENT_TERMS=NT30
SAP_RECONCILIATION_ACCOUNT=12120100
SAP_TAX_TYPE=CO3
SAP_SALES_ORDER_TYPE=OR
SAP_SALES_ORGANIZATION=4601
SAP_DISTRIBUTION_CHANNEL=CF
SAP_ORGANIZATION_DIVISION=10
SAP_MATERIAL=Q01
SAP_MATERIAL_UNIT=L
SAP_DEFAULT_CURRENCY=CLP
SAP_DEFAULT_COUNTRY=CL

# ─── Runtime ───
PORT=3000
NODE_ENV=development
SYNC_LOCK_TIMEOUT_MS=30000
MAX_RETRY_ATTEMPTS=5
SAP_POLL_INTERVAL_MS=300000
```

### Validación

Todas las variables se validan al arrancar con un esquema **Zod** en `src/config/env.schema.ts`. Si alguna falta o tiene formato inválido, el proceso termina con un mensaje de error formateado que indica exactamente qué variable falló y por qué.

---

## Scripts Disponibles

```bash
# Desarrollo con hot-reload
npm run dev

# Compilar TypeScript a JavaScript
npm run build

# Ejecutar en producción (requiere build previo)
npm start

# Ejecutar tests
npm test

# Linter
npm run lint

# Formatear código
npm run format

# Migraciones Prisma
npx prisma migrate dev     # Desarrollo (crea/aplica migraciones)
npx prisma migrate deploy  # Producción (aplica migraciones pendientes)
npx prisma generate        # Genera el cliente Prisma
```

---

## Configuración y Herramientas

### TypeScript (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "**/*.test.ts", "src/scripts"]
}
```

### Prettier (`.prettierrc`)

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Vitest (`vitest.config.ts`)

```typescript
{
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
}
```

### Railway (`railway.toml`)

```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
startCommand = "npm run start"
```

---

## Despliegue

### Railway (Producción)

El proyecto se despliega en **Railway** con tres servicios:

1. **Node.js App:** La aplicación Express principal.
2. **PostgreSQL 16:** Base de datos relacional (id_map, sync_log, retry_job).
3. **Redis 7:** Backend para BullMQ (cola de trabajos).

### Proceso de Deploy

1. Push a `main` en GitHub.
2. Railway detecta el cambio y ejecuta Nixpacks build (`npm run build`).
3. Se ejecuta `npm run start` (`node dist/index.js`).
4. La app valida variables de entorno con Zod al arrancar.
5. Se conecta a PostgreSQL y Redis.
6. Inicia Express, BullMQ Worker y SAP Poller.

### Graceful Shutdown

Al recibir `SIGTERM` o `SIGINT`:
1. Detiene el SAP Poller.
2. Cierra el BullMQ Worker (espera jobs en curso).
3. Cierra la cola BullMQ.
4. Cierra el servidor Express.
5. El proceso termina limpiamente.

---

## Constantes SAP de Producción

```typescript
SalesOrderType        = "OR"        // Orden de Venta estándar
SalesOrganization     = "4601"      // Organización de ventas Química Sur
DistributionChannel   = "CF"        // Canal de distribución
OrganizationDivision  = "10"        // División
Material              = "Q01"       // Material por defecto
MaterialUnit          = "L"         // Unidad: Litros
CompanyCode           = "4610"      // Código de empresa SAP
BPGrouping            = "BP02"      // Agrupación de Business Partners
Roles                 = ["FLCU00", "FLCU01"]  // Roles de cliente
PaymentTerms          = "NT30"      // Condición de pago: Neto 30 días
ReconciliationAccount = "12120100"  // Cuenta de reconciliación
CorrespondenceLanguage= "ES"        // Español
BPTaxType             = "CO3"       // Tipo RUT Chile
```

---

## Hallazgos Verificados en Producción

### SAP

1. **Teléfonos:** NO incluir código país en `PhoneNumber`. Usar campo separado `DestinationLocationCountry`. Genera Warning T5/194 si se incluye.
2. **Email/Phone/Mobile:** Son sub-entities del Address con clave compuesta: `AddressID + Person + OrdinalNumber`.
3. **`$expand` NO funciona con `$select`** en OData v2 — se debe usar uno u otro.
4. **`LastChangeDate` es null** hasta el primer PATCH (se popula después).
5. **ETag formatos distintos:** BP = string plano, SalesOrder = `W/"datetimeoffset'...'"`.
6. **`TotalNetAmount` es READ-ONLY** en SalesOrder (calculado desde items).
7. **PATCH devuelve 204** sin body — no se puede verificar el resultado directo.
8. **Payload mínimo BP verificado:** Category, Grouping, Name, Language, Address(Street, City, Country, Language, PostalCode), Tax(CO3), Roles(FLCU00+FLCU01), CustomerCompany(CC, PT, RA). NO incluir Language en CustomerCompany.
9. **`BusinessPartnerIDByExtSystem`** (max 20 caracteres) — campo para guardar HubSpot ID en SAP.

### HubSpot

1. **Contact** usa `lastmodifieddate` (SIN prefijo `hs_`), porque `hs_lastmodifieddate` viene `null` en GET list.
2. **Company y Deal** SÍ usan `hs_lastmodifieddate`.
3. **PATCH devuelve 200** con objeto actualizado completo — útil para verificar el resultado.

---

# English

## Overview

**hubspot-sap-integration** is a backend service that provides real-time bidirectional synchronization of three business entities between **HubSpot CRM** (commercial management platform) and **SAP S/4HANA Cloud** (enterprise ERP) for **Química Sur**, a chemical industry company in Chile.

### Problem Statement

Química Sur manages its commercial operations in HubSpot and its financial/operational processes in SAP. Without this integration, teams must manually duplicate customer, company, and deal information across both systems, leading to:

- **Inconsistent data** across systems.
- **Wasted time** on duplicate manual entry.
- **Human errors** in data transcription.
- **Lack of traceability** over who changed what and when.

### Solution

The system listens to HubSpot webhooks and performs periodic polling of SAP, automatically propagating changes in both directions. It implements:

- **Anti-loop** mechanism to prevent infinite synchronization loops.
- **Last-Write-Wins (LWW)** for concurrent write conflict resolution.
- **Persistent queue** (BullMQ + Redis) with exponential retry backoff.
- **Complete audit trail** for every synchronization operation.
- **ID mapping** between both systems.

### v1 Scope

| HubSpot Entity | SAP Entity                        | Operations           |
|---------------|-----------------------------------|----------------------|
| Contact       | BusinessPartner (Category=1)      | CREATE, READ, UPDATE |
| Company       | BusinessPartner (Category=2)      | CREATE, READ, UPDATE |
| Deal          | SalesOrder                        | CREATE, READ, UPDATE |

**Out of scope v1:** Lead (94 properties), Sales Quotation, bidirectional DELETE, billing calculation fields (~40 custom fields).

---

## Technology Stack

### Runtime and Language

| Technology    | Version | Purpose                                    |
|---------------|---------|-------------------------------------------|
| Node.js       | 24.13.1 | Server-side JavaScript runtime             |
| TypeScript    | 5       | Static typing, compile-time safety         |

### Core Framework and Libraries

| Library        | Version | Purpose                                          |
|---------------|---------|--------------------------------------------------|
| Express       | 4       | HTTP framework for receiving webhooks             |
| Axios         | 1       | HTTP client for HubSpot and SAP API calls         |
| Zod           | 3       | Schema validation (env vars, webhook payloads)    |
| BullMQ        | 5       | Job queue with Redis (retries, deduplication)     |
| @prisma/client| 7       | ORM for PostgreSQL (repositories, migrations)     |
| dotenv        | 16      | Environment variable loading from `.env`          |

### Development Tools

| Tool          | Version | Purpose                                           |
|---------------|---------|--------------------------------------------------|
| Vitest        | 4       | Testing framework (307+ tests)                    |
| Supertest     | -       | HTTP endpoint testing                             |
| ESLint        | 9       | TypeScript code linter                            |
| Prettier      | 3       | Code formatter                                    |
| tsx           | 4       | Direct TypeScript execution with hot-reload       |
| ts-node       | 10      | TypeScript execution for Prisma CLI               |
| Prisma CLI    | 7       | Migrations and client generation                  |

### Infrastructure (Production)

| Service       | Version/Provider | Purpose                               |
|---------------|------------------|---------------------------------------|
| Railway       | PaaS             | Node.js application hosting           |
| PostgreSQL    | 16               | Relational database (Railway)         |
| Redis         | 7                | BullMQ backend (Railway)              |
| Nixpacks      | -                | Build system on Railway               |

### External APIs

| API                          | Protocol  | Authentication                |
|------------------------------|-----------|-------------------------------|
| HubSpot CRM API v3           | REST JSON | Bearer Token (Private App)    |
| SAP S/4HANA OData v2         | OData XML | Basic Auth + CSRF Token       |

> **Note on Prisma:** Migrated from Prisma 5 to Prisma 7 due to incompatibility with Node.js 24.

---

## System Architecture

### High-Level Diagram

```
┌──────────────┐    Webhooks     ┌──────────────────────────────┐    OData v2    ┌──────────────┐
│              │  ────────────►  │                              │  ────────────► │              │
│   HubSpot    │                 │   hubspot-sap-integration    │                │  SAP S/4HANA │
│   CRM v3     │  ◄────────────  │         (Node.js)            │  ◄──────────── │    Cloud     │
│              │   REST API      │                              │   Polling 5m   │              │
└──────────────┘                 └──────────┬───────────────────┘                └──────────────┘
                                            │
                                 ┌──────────┼──────────┐
                                 │          │          │
                              ┌──▼──┐   ┌───▼──┐   ┌──▼──┐
                              │ PG  │   │Redis │   │Logs │
                              │ 16  │   │  7   │   │     │
                              └─────┘   └──────┘   └─────┘
```

### Architectural Pattern

The system uses an **event-driven architecture** with the following patterns:

1. **Webhook Consumer:** Receives HubSpot events, validates, and enqueues them.
2. **Job Queue (Producer/Consumer):** BullMQ decouples reception from processing.
3. **Serial Worker:** Processes one job at a time (concurrency=1) to prevent race conditions with SAP CSRF tokens and ETags.
4. **Reverse Polling:** An internal cron queries SAP every 5 minutes for changes.
5. **Repository Pattern:** Abstracts PostgreSQL access through dedicated repositories.
6. **Adapter Pattern:** Encapsulates external API communication in independent clients.

### Application Layers

```
┌─────────────────────────────────────────────┐
│            Transport Layer                   │
│   Express + Middleware (auth, error)         │
│   POST /webhooks/hubspot · GET /health       │
├─────────────────────────────────────────────┤
│            Queue Layer                       │
│   BullMQ Queue + Worker                      │
│   Deduplication, exponential retries         │
├─────────────────────────────────────────────┤
│            Service Layer                     │
│   SyncService (orchestrator)                 │
│   MapperService (transformations)            │
│   ConflictService (LWW)                      │
│   SapPollerService (SAP→HS polling)          │
├─────────────────────────────────────────────┤
│            Adapter Layer                     │
│   SapClient (Basic Auth + CSRF + ETag)       │
│   HubSpotClient (Bearer + retry 429)         │
├─────────────────────────────────────────────┤
│            Persistence Layer                 │
│   Prisma ORM + PostgreSQL                    │
│   Repositories: IdMap, SyncLog, RetryJob     │
└─────────────────────────────────────────────┘
```

---

## Project Structure

```
hubspot-sap-integration/
│
├── .env                            # Environment variables (NOT in repository)
├── .env.example                    # Environment variable template
├── .gitignore                      # Git-excluded files
├── .prettierrc                     # Prettier config
├── eslint.config.mjs               # ESLint 9 config
├── package.json                    # Dependencies and npm scripts
├── tsconfig.json                   # TypeScript config (ES2022, CommonJS, strict)
├── vitest.config.ts                # Vitest config (test runner)
├── prisma.config.ts                # Prisma 7 config (reads DATABASE_URL from .env)
├── railway.toml                    # Railway deploy config (Nixpacks)
├── CLAUDE.md                       # Project context for Claude Code
├── stack.md                        # Stack documentation
│
├── prisma/
│   └── schema.prisma               # Database schema (3 models + 4 enums)
│
├── src/
│   ├── index.ts                    # Entry point: Express app, /health, graceful shutdown
│   │
│   ├── config/
│   │   ├── env.ts                  # Validated configuration singleton
│   │   └── env.schema.ts           # Zod schema with 40+ environment variables
│   │
│   ├── adapters/
│   │   ├── sap/
│   │   │   ├── sap.client.ts       # Axios client for SAP OData v2
│   │   │   └── sap.types.ts        # SAP entity TypeScript interfaces
│   │   │
│   │   └── hubspot/
│   │       ├── hubspot.client.ts    # Axios client for HubSpot API v3
│   │       └── hubspot.types.ts     # HubSpot entity TypeScript interfaces
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   └── hubspot.routes.ts    # Webhook routes (POST /webhooks/hubspot)
│   │   │
│   │   └── middleware/
│   │       ├── auth.middleware.ts    # HubSpot webhook HMAC-SHA256 verification
│   │       └── error.middleware.ts   # Centralized error handling (Axios, Zod, generic)
│   │
│   ├── services/
│   │   ├── sync.service.ts          # Main synchronization orchestrator
│   │   ├── mapper.service.ts        # HubSpot ↔ SAP data transformations
│   │   ├── conflict.service.ts      # Last-Write-Wins timestamp resolution
│   │   └── sap-poller.service.ts    # SAP → HubSpot poller (every 5 minutes)
│   │
│   ├── queue/
│   │   ├── sync.queue.ts            # BullMQ queue (jobId deduplication)
│   │   └── sync.worker.ts           # BullMQ worker (concurrency=1, rate limited)
│   │
│   ├── db/
│   │   ├── prisma.client.ts         # PrismaClient singleton
│   │   └── repositories/
│   │       ├── idmap.repository.ts       # CRUD + sync locks for id_map
│   │       ├── synclog.repository.ts     # Immutable audit log
│   │       └── retryjob.repository.ts    # Failed job persistence
│   │
│   └── types/
│       └── webhook.schemas.ts       # Zod schemas for webhook payloads
│
└── tests/                           # 24 test files, 307+ tests
    ├── health.test.ts
    ├── env.test.ts
    ├── auth.middleware.test.ts
    ├── error.middleware.test.ts
    ├── hubspot.client.test.ts
    ├── sap.client.test.ts
    ├── hubspot.routes.test.ts
    ├── hubspot.routes-extended.test.ts
    ├── sync.service.test.ts
    ├── sync.service-extended.test.ts
    ├── mapper.service.test.ts
    ├── mapper.service-extended.test.ts
    ├── conflict.service.test.ts
    ├── sap-poller.service.test.ts
    ├── sap-poller-extended.test.ts
    ├── sync.queue.test.ts
    ├── sync.worker.test.ts
    ├── sync.worker-extended.test.ts
    ├── idmap.repository.test.ts
    ├── synclog.repository.test.ts
    ├── retryjob.repository.test.ts
    ├── prisma.client.test.ts
    └── webhook.schemas.test.ts
```

### File Descriptions

#### Root Files

| File               | Description                                                           |
|--------------------|-----------------------------------------------------------------------|
| `package.json`     | Project dependencies, npm scripts, name and version                   |
| `tsconfig.json`    | TS compiler: target ES2022, CommonJS modules, strict mode enabled     |
| `vitest.config.ts` | Test runner: Node environment, globals enabled, `tests/**/*.test.ts`  |
| `prisma.config.ts` | Prisma 7 configuration: reads `DATABASE_URL` from `.env`             |
| `eslint.config.mjs`| ESLint 9 flat config for TypeScript                                   |
| `.prettierrc`      | Formatting: semicolons, single quotes, trailing commas, 100 cols      |
| `railway.toml`     | Deploy: Nixpacks build, `npm run start`                               |

#### `src/index.ts` — Entry Point

Creates the Express application with:
- **Trust proxy** enabled (Railway uses a reverse proxy).
- **`express.raw()`** on `/webhooks/hubspot` (required for HMAC signature verification).
- **`express.json()`** for all other routes.
- **GET `/health`** route returning `{ status: "ok", timestamp, uptime }`.
- Webhook route and error middleware mounting.
- **SapPoller** and **SyncWorker** startup.
- **Graceful shutdown:** closes worker, queue, poller, and server on SIGTERM/SIGINT.

#### `src/config/` — Configuration

- **`env.schema.ts`**: Zod schema defining and validating 40+ environment variables with types, defaults, and transforms (e.g., `SAP_BP_ROLES` string transforms to array).
- **`env.ts`**: Singleton exporting validated configuration. If validation fails, prints formatted errors and exits with `process.exit(1)`.

#### `src/adapters/sap/` — SAP Client

- **`sap.client.ts`** (323 lines): Singleton Axios client with:
  - **Basic Auth**: `Authorization: Basic base64(user:pass)`.
  - **CSRF Token**: HEAD request with `x-csrf-token: fetch`, cached for 25 minutes.
  - **403 Interceptor**: Invalidates CSRF, refreshes, retries once (flag `_csrfRetried`).
  - **`patchWithETag(url, data)`**: GET resource → extract ETag header → PATCH with `If-Match`.
  - Timeout: 30 seconds.

- **`sap.types.ts`**: TypeScript interfaces for OData v2 entities:
  - `SapBusinessPartner` (Category 1=person, 2=organization).
  - `SapBPAddress`, `SapBPPhone`, `SapBPEmail`, `SapBPTaxNumber`.
  - `SapBPRole`, `SapCustomerCompany`, `SapCustomerSalesArea`, `SapBPBank`.
  - `SapSalesOrder`, `SapSalesOrderItem`.
  - Wrappers: `ODataResponse<T>`, `ODataListResponse<T>`.
  - Create/update payload types using `Omit<>` to exclude READ-ONLY fields.

#### `src/adapters/hubspot/` — HubSpot Client

- **`hubspot.client.ts`** (234 lines): Singleton Axios client with:
  - **Bearer Token**: `Authorization: Bearer {token}`.
  - **429 Retry**: Reads `Retry-After` header, waits, retries up to 3 times.
  - Timeout: 15 seconds.

- **`hubspot.types.ts`**: TypeScript interfaces for HubSpot v3 entities:
  - `HubSpotContactProperties` (30+ fields, includes custom: `comuna`, `id_sap`).
  - `HubSpotCompanyProperties` (25+ fields, includes custom: `rut_empresa`, `condicion_venta`, `razon_social`, `id_sap`).
  - `HubSpotDealProperties` (20+ fields, includes custom: `condicion_de_pago`, `orden_de_compra_o_contratoo`, `id_sap`).
  - Wrappers: `HubSpotObjectResponse<T>`, `HubSpotListResponse<T>`, `HubSpotUpdatePayload<T>`.

#### `src/api/middleware/` — Middleware

- **`auth.middleware.ts`**: Express middleware verifying HubSpot HMAC-SHA256 v3 webhook signatures:
  1. Extracts `X-HubSpot-Signature-v3` and `X-HubSpot-Request-Timestamp` headers.
  2. Anti-replay: Rejects requests with timestamp older than 5 minutes.
  3. Reconstructs `sourceString = METHOD + URL + BODY + TIMESTAMP`.
  4. Computes `HMAC-SHA256(sourceString, CLIENT_SECRET)` in Base64.
  5. Compares using `crypto.timingSafeEqual` (prevents timing attacks).
  6. Returns 401 if signature is invalid.

- **`error.middleware.ts`**: Centralized error handler (4-parameter Express middleware):
  - **AxiosError**: Returns 502 with external API error details.
  - **ZodError**: Returns 422 with validation details.
  - **Generic Error**: Returns 500.
  - In development: includes stack traces. In production: generic messages for security.

#### `src/api/routes/` — Routes

- **`hubspot.routes.ts`**: Defines `POST /webhooks/hubspot`:
  1. `verifyHubSpotSignature` middleware validates the signature.
  2. Parses body (Buffer → JSON).
  3. Validates with `webhookPayloadSchema` (Zod).
  4. Classifies each event: Contact, Company, Deal, deletion, merge, restore, associationChange.
  5. Special handling for `associationChange` (Deal↔Company): uses `fromObjectId`/`toObjectId`.
  6. Enqueues via `addSyncJob()` (deduplication by jobId).
  7. Returns 200 immediately (async processing).

#### `src/services/` — Business Services

- **`sync.service.ts`** (716 lines): Main orchestrator:
  1. Determines CREATE vs UPDATE by querying `id_map`.
  2. Anti-loop check: if `syncInProgress=true` and same system within timeout → SKIPPED.
  3. LWW check: if event timestamp ≤ `updatedAt` → SKIPPED.
  4. Reads complete object from HubSpot.
  5. For Deal: `resolveCompanyForDeal()` verifies associated Company exists in id_map.
  6. If Company is missing, throws `MissingDependencyError` (retriable, BullMQ retries).
  7. Transforms with mapper.
  8. Creates/updates in SAP.
  9. Logs to sync_log.
  10. Returns `SyncResult { success, operation, entityType, hubspotId, sapId }`.

- **`mapper.service.ts`** (12.8k+ tokens): Pure transformation functions with no side effects:
  - `createContactPayload()`: HubSpot Contact → SAP BP Create.
  - `updateContactPayload()`: HubSpot Contact → SAP BP Update.
  - `sapBPToContactUpdate()`: SAP BP → HubSpot Contact.
  - `createCompanyPayload()`: HubSpot Company → SAP BP Create.
  - `updateCompanyPayload()`: HubSpot Company → SAP BP Update.
  - `sapBPToCompanyUpdate()`: SAP BP → HubSpot Company.
  - `createDealPayload()`: HubSpot Deal → SAP SalesOrder Create.
  - `updateDealPayload()`: HubSpot Deal → SAP SalesOrder Update.
  - `salesOrderToDealUpdate()`: SAP SalesOrder → HubSpot Deal.
  - Helpers: `sapDateTimeToMs()`, `sapDateTimeOffsetToMs()`, `COUNTRY_MAP`, `MAX_LENGTHS`.

- **`conflict.service.ts`** (215 lines): Last-Write-Wins resolution:
  - `evaluateHubSpotEvent()`: Compares event timestamp vs last sync.
  - `evaluateSapBPEvent()`: Parses SAP `LastChangeDate + LastChangeTime`.
  - `evaluateSapSOEvent()`: Parses SalesOrder `LastChangeDateTime` (DateTimeOffset).
  - First sync (no prior record): always proceed.
  - Handles null timestamps (production finding).

- **`sap-poller.service.ts`** (672 lines): SAP → HubSpot polling every 5 minutes:
  - `pollBusinessPartners()`: Filters by `LastChangeDate ge {timestamp}`.
  - `pollSalesOrders()`: Filters by `LastChangeDateTime ge {timestamp}`.
  - `syncBPToHubSpot(bp)`: Anti-loop + hash dedup + mapper + PATCH HubSpot.
  - `syncSalesOrderToHubSpot(so)`: Similar to BP for Deals.
  - Association sync: Deal↔Company and Contact↔Company.
  - Hash deduplication with MD5: avoids updates when data hasn't actually changed.
  - Duplicate email handling: retries without email if HubSpot rejects.
  - `startSapPoller()` / `stopSapPoller()`: Interval control.

#### `src/queue/` — Job Queue

- **`sync.queue.ts`**: BullMQ queue `hubspot-sap-sync`:
  - Parses `REDIS_URL` to extract host/port/password/username.
  - Default job options: `attempts = MAX_RETRY_ATTEMPTS`, exponential backoff (1s base).
  - `removeOnComplete: { count: 1000 }`, `removeOnFail: { count: 5000 }`.
  - `addSyncJob(event)`: Generates jobId = `{entityType}-{objectId}-{occurredAt}` (deduplication).

- **`sync.worker.ts`** (232 lines): BullMQ Worker:
  - Concurrency = 1 (serial processing, prevents CSRF/ETag race conditions).
  - Rate limiter: 10 jobs / 60 seconds.
  - `processJob(job)`: Invokes `syncHubSpotToSap(event)`.
  - `failed` event handler: Registers in `retry_job` table with backoff calculation.
  - Special handling for `MissingDependencyError`: logs with additional context.

#### `src/db/` — Persistence

- **`prisma.client.ts`** (95 lines): PrismaClient singleton:
  - In development: uses `globalThis` to survive hot-reload from `tsx watch`.
  - In production: direct instance.
  - Uses `@prisma/adapter-pg` adapter for connection.
  - Configurable logging: query+warn+error (dev), error only (prod).

- **`idmap.repository.ts`** (159 lines):
  - `findByHubSpotId(entityType, hubspotId)`: Lookup by unique constraint.
  - `findBySapId(entityType, sapId)`: Lookup by unique constraint.
  - `create(data)`: Insert new mapping.
  - `acquireSyncLock(id, initiatedBy)`: Activate lock, mark initiator and timestamp.
  - `releaseSyncLock(id)`: Deactivate lock, clear fields.
  - `isSyncLocked(id)`: Returns `{locked, initiatedBy}`, checks 30s timeout.

- **`synclog.repository.ts`** (126 lines): Immutable table (INSERT only, never UPDATE/DELETE):
  - `create(data)`: Insert audit record.
  - `findByIdMap(idMapId, limit)`: Entity history.
  - `findRecent(limit)`: Most recent records.

- **`retryjob.repository.ts`** (120 lines):
  - `create(data)`: Register failed job.
  - `updateAttempt(bullmqJobId, error, nextRetryAt)`: Increment counter.
  - `markExhausted(bullmqJobId, error)`: Mark as exhausted (requires manual intervention).
  - `findPending(limit)` / `findExhausted(limit)`: Queries for monitoring.

#### `src/types/` — Types and Schemas

- **`webhook.schemas.ts`**: Zod schemas for HubSpot webhooks:
  - 13 subscription types: `contact.creation`, `contact.propertyChange`, `deal.associationChange`, etc.
  - Fields: `occurredAt`, `objectId`, `objectTypeId`, `propertyName`, `propertyValue`.
  - Association fields: `fromObjectId`, `toObjectId`, `changeFlag`, `associationType`.
  - Narrowing helpers: `isContactEvent()`, `isCompanyEvent()`, `isDealEvent()`, `isCreationEvent()`, `isPropertyChangeEvent()`, `isAssociationChangeEvent()`, etc.

---

## Data Model

### Entity-Relationship Diagram

```
┌──────────────────────────────────┐
│            id_map                │
├──────────────────────────────────┤
│ id              UUID PK          │
│ entityType      ENUM             │◄──── CONTACT | COMPANY | DEAL
│ hubspotId       STRING UNIQUE    │
│ sapId           STRING UNIQUE    │
│ syncInProgress  BOOLEAN          │◄──── Anti-loop
│ syncInitiatedBy ENUM nullable    │◄──── HUBSPOT | SAP
│ syncStartedAt   DATETIME nullable│
│ createdAt       DATETIME         │
│ updatedAt       DATETIME         │◄──── Timestamp for LWW
├──────────────────────────────────┤
│ UK: (entityType, hubspotId)      │
│ UK: (entityType, sapId)          │
└────────────┬─────────────────────┘
             │ 1:N
             ▼
┌──────────────────────────────────┐
│           sync_log               │
├──────────────────────────────────┤
│ id              UUID PK          │
│ idMapId         UUID FK nullable │
│ entityType      ENUM             │
│ operation       ENUM             │◄──── CREATE | UPDATE | DELETE
│ sourceSystem    ENUM             │◄──── HUBSPOT | SAP
│ targetSystem    ENUM             │
│ status          ENUM             │◄──── PENDING | IN_FLIGHT | SUCCESS | FAILED | SKIPPED
│ inboundPayload  JSON             │
│ outboundPayload JSON nullable    │
│ errorMessage    STRING nullable  │
│ errorCode       STRING nullable  │
│ attemptNumber   INT              │
│ createdAt       DATETIME         │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│          retry_job               │
├──────────────────────────────────┤
│ id              UUID PK          │
│ bullmqJobId     STRING UNIQUE    │
│ payload         JSON             │
│ maxAttempts     INT (default 5)  │
│ attemptCount    INT              │
│ nextRetryAt     DATETIME         │
│ lastError       STRING nullable  │
│ exhausted       BOOLEAN          │
│ createdAt       DATETIME         │
│ updatedAt       DATETIME         │
└──────────────────────────────────┘
```

### Database Enums

```typescript
enum EntityType   { CONTACT, COMPANY, DEAL }
enum SystemSource { HUBSPOT, SAP }
enum SyncOperation{ CREATE, UPDATE, DELETE }
enum SyncStatus   { PENDING, IN_FLIGHT, SUCCESS, FAILED, SKIPPED }
```

---

## Synchronized Entities

### Contact ↔ BusinessPartner (Person, Category=1)

A **Contact** in HubSpot represents an individual person. In SAP, it maps to a **BusinessPartner** with `BusinessPartnerCategory = "1"` (natural person).

- **HS→SAP direction:** Webhook on creation/modification triggers immediate sync.
- **SAP→HS direction:** Poller every 5 minutes detects changes via `LastChangeDate`.
- **SAP constants on create:** Grouping=BP02, Language=ES, Roles=[FLCU00, FLCU01], CustomerCompany with CompanyCode=4610, PaymentTerms=NT30, ReconciliationAccount=12120100.

### Company ↔ BusinessPartner (Organization, Category=2)

A **Company** in HubSpot represents a business organization. In SAP, it maps to a **BusinessPartner** with `BusinessPartnerCategory = "2"` (organization).

- Similar to Contact but with organization-specific fields: `OrganizationBPName1/2/3`, `SearchTerm1`, `BPTaxNumber` (Chilean RUT).
- HubSpot-only fields (no sync): domain, numberofemployees, annualrevenue, giro, vendedor, branches.

### Deal ↔ SalesOrder

A **Deal** in HubSpot represents a sales opportunity. In SAP, it maps to a **SalesOrder**.

- **Critical dependency:** The Company associated with the Deal MUST already exist in id_map. If missing, `MissingDependencyError` is thrown and BullMQ retries automatically.
- **SAP constants on create:** SalesOrderType=OR, SalesOrganization=4601, DistributionChannel=CF, OrganizationDivision=10, Material=Q01, MaterialUnit=L.
- **READ-ONLY field:** `amount` in HubSpot ← `TotalNetAmount` in SAP (calculated from items, cannot be written).

---

## Field Mapping

### Contact ↔ BusinessPartner Person

| HubSpot Field      | SAP Field                          | Direction | Notes                                     |
|--------------------|------------------------------------|-----------|-------------------------------------------|
| `firstname`        | `FirstName`                        | ↔         | Direct mapping                            |
| `lastname`         | `LastName`                         | ↔         | Direct mapping                            |
| `email`            | `to_EmailAddress.EmailAddress`     | ↔         | Address sub-entity (separate POST)        |
| `phone`            | `to_PhoneNumber.PhoneNumber`       | ↔         | No country code, use DestinationLocationCountry |
| `mobilephone`      | `to_MobilePhoneNumber.PhoneNumber` | ↔         | Type=3 (same entity as phone)             |
| `fax`              | `to_FaxNumber.FaxNumber`           | →         | Low priority v1                           |
| `address`          | `StreetName`                       | ↔         | In to_BusinessPartnerAddress              |
| `city`             | `CityName`                         | ↔         | In Address                                |
| `zip`              | `PostalCode`                       | ↔         | In Address                                |
| `country`          | `Country`                          | ↔         | Text → ISO 2-letter (COUNTRY_MAP)         |
| `state`            | `Region`                           | ↔         | SAP region code                           |
| `comuna` (custom)  | `District`                         | ↔         | Custom field for Química Sur              |
| `company`          | `NaturalPersonEmployerName`        | ↔         | Max 35 characters                         |
| `jobtitle`         | `BusinessPartnerOccupation`        | ↔         | Code mapping                              |
| `salutation`       | `FormOfAddress`                    | ↔         | Code mapping                              |
| `industry`         | `Industry`                         | ↔         | Code mapping                              |
| `id_sap` (custom)  | `BusinessPartner` (ID)             | ←         | Written to HS when created in SAP         |

**LWW Timestamp Contact:** `lastmodifieddate` (NOT `hs_lastmodifieddate`) ↔ `LastChangeDate + LastChangeTime`

### Company ↔ BusinessPartner Organization

| HubSpot Field              | SAP Field                     | Direction | Notes                              |
|----------------------------|-------------------------------|-----------|------------------------------------|
| `name`                     | `OrganizationBPName1`         | ↔         | Max 40 characters                  |
| `description`              | `OrganizationBPName2`         | →         | Name overflow                      |
| `phone`                    | `to_PhoneNumber.PhoneNumber`  | ↔         | Address sub-entity                 |
| `address/city/zip/state`   | Address fields                | ↔         | Same as Contact                    |
| `country`                  | `Country`                     | ↔         | ISO 2-letter                       |
| `comuna` (custom)          | `District`                    | ↔         | Custom field                       |
| `rut_empresa` (custom)     | `BPTaxNumber`                 | ↔         | BPTaxType=CO3 (Chilean RUT)        |
| `condicion_venta` (custom) | `CustomerCompany.PaymentTerms`| ↔         | Payment terms                      |
| `razon_social` (custom)    | `SearchTerm1` / `BPName3`     | →         | Max 20ch / 40ch                    |
| `industry`                 | `Industry`                    | ↔         | Code mapping                       |
| `founded_year`             | `OrganizationFoundationDate`  | ↔         | Year → full date                   |
| `id_sap` (custom)          | `BusinessPartner` (ID)        | ←         | Written to HS when created in SAP  |

**LWW Timestamp Company:** `hs_lastmodifieddate` ↔ `LastChangeDate + LastChangeTime`

### Deal ↔ SalesOrder

| HubSpot Field                          | SAP Field                      | Direction | Notes                                   |
|----------------------------------------|--------------------------------|-----------|-----------------------------------------|
| `dealname`                             | `PurchaseOrderByCustomer`      | ↔         | Max 35 characters                       |
| `amount`                               | `TotalNetAmount`               | ←         | READ-ONLY (calculated from SAP items)   |
| `closedate`                            | `RequestedDeliveryDate`        | ↔         | Requested delivery date                 |
| `deal_currency_code`                   | `TransactionCurrency`          | ↔         | ISO currency code                       |
| `condicion_de_pago` (custom)           | `CustomerPaymentTerms`         | ↔         | Payment terms                           |
| `fecha_de_entrega` (custom)            | `RequestedDeliveryDate`        | ↔         | Takes priority over closedate           |
| `orden_de_compra_o_contratoo` (custom) | `PurchaseOrderByCustomer`      | →         | Takes priority over dealname            |
| `cuanto_es_la_cantidad_...` (custom)   | `to_Item.RequestedQuantity`    | ↔         | Product quantity                        |
| Associated Company                     | `SoldToParty`                  | →         | Via id_map (Company must exist first)   |
| `hubspot_owner_id`                     | `to_Partner[ER].Personnel`     | ↔         | User mapping                            |
| `dealstage`                            | `OverallSDProcessStatus`       | ←         | Complex status mapping                  |
| `pipeline`                             | —                              | —         | HubSpot only, no SAP equivalent         |
| `id_sap` (custom)                      | `SalesOrder` (ID)              | ←         | Written to HS when created in SAP       |

**LWW Timestamp Deal:** `hs_lastmodifieddate` ↔ `LastChangeDateTime` (DateTimeOffset)

---

## Synchronization Flow

### HubSpot → SAP (Webhook-driven)

```
1. HubSpot fires webhook POST /webhooks/hubspot
       │
2. auth.middleware verifies HMAC-SHA256 v3 signature
       │
3. Payload validated with Zod (webhookPayloadSchema)
       │
4. Each event classified (Contact/Company/Deal)
       │
5. addSyncJob() enqueues to BullMQ (dedup by jobId)
       │
6. Returns 200 OK immediately
       │
7. Worker picks up job (concurrency=1)
       │
8. syncHubSpotToSap(event):
       │
       ├── Exists in id_map? → Yes: UPDATE, No: CREATE
       │
       ├── Lock active from opposite system within 30s?
       │   └── Yes → SKIPPED (anti-loop)
       │
       ├── Event timestamp > last sync?
       │   └── No → SKIPPED (LWW)
       │
       ├── Read complete object from HubSpot
       │
       ├── [Deal only] Company exists in id_map?
       │   └── No → MissingDependencyError (retry)
       │
       ├── Mapper transforms HS → SAP payload
       │
       ├── POST (create) or patchWithETag (update) to SAP
       │
       ├── Create/update id_map + log to sync_log
       │
       └── Return SyncResult { success: true }
```

### SAP → HubSpot (Polling every 5 minutes)

```
1. setInterval every 5 minutes (SAP_POLL_INTERVAL_MS)
       │
2. pollBusinessPartners():
       │   GET /API_BUSINESS_PARTNER/A_BusinessPartner
       │   $filter=LastChangeDate ge '{timestamp}'
       │
       ├── For each modified BP:
       │   ├── Exists in id_map? → No: ignore
       │   ├── Lock active from HS within 30s? → SKIP
       │   ├── Data hash changed? → No: SKIP (dedup)
       │   ├── Read full BP from SAP (with address)
       │   ├── Mapper transforms SAP → HS payload
       │   ├── PATCH to HubSpot
       │   ├── Sync associations (Contact↔Company)
       │   └── Log to sync_log
       │
3. pollSalesOrders():
       │   GET /API_SALES_ORDER_SRV/A_SalesOrder
       │   $filter=LastChangeDateTime ge datetimeoffset'{timestamp}'
       │
       └── Similar to BPs but for Deals
              └── Syncs Deal↔Company association
```

---

## Anti-Loop Mechanism

### Problem

When the system syncs a Contact from HubSpot to SAP, the modification in SAP could be detected by the poller, generating a sync back to HubSpot, which would in turn generate another webhook... creating an **infinite loop**.

### Solution

A **temporary lock** system in the `id_map` table:

```
┌─────────┐     Webhook        ┌────────────┐   PATCH    ┌─────────┐
│ HubSpot │ ──────────────────►│ Integration│──────────► │   SAP   │
│         │                    │   Server   │            │         │
└─────────┘                    └──────┬─────┘            └────┬────┘
                                     │                        │
                              ┌──────▼─────┐                  │
                              │  id_map    │                  │
                              │ locked=true│                  │
                              │ by=HUBSPOT │                  │
                              └──────┬─────┘                  │
                                     │                        │
                                     │  Poller detects change │
                                     │◄───────────────────────┘
                                     │
                              locked=true AND by=HUBSPOT?
                                     │
                                   [YES] → SKIP (don't sync back)
                                     │
                              [30s later]
                              locked=false → Normal
```

### Fields in `id_map`

| Field            | Type     | Description                                 |
|------------------|----------|---------------------------------------------|
| `syncInProgress` | BOOLEAN  | `true` while a sync is in progress           |
| `syncInitiatedBy`| ENUM     | Who initiated: `HUBSPOT` or `SAP`            |
| `syncStartedAt`  | DATETIME | When the lock was activated                   |

### Rules

1. **Activate lock:** Before writing to the target system.
2. **Check lock:** When receiving an event, if `locked=true` AND the initiator is the **opposite** system AND less than 30 seconds have elapsed → SKIP.
3. **Release lock:** After completing synchronization.
4. **Timeout:** If more than 30 seconds have elapsed, the lock is considered expired (sync probably failed).

---

## Conflict Resolution (Last-Write-Wins)

### Problem

If one user modifies a Contact in HubSpot and another user modifies the same Contact in SAP nearly simultaneously, which change prevails?

### Solution

**Last-Write-Wins (LWW):** The most recent change by timestamp always wins.

```
Event arrives with T_event
       │
       ▼
Does id_map exist for this entity?
       │
       ├── No → First sync, PROCEED
       │
       └── Yes → Compare T_event vs id_map.updatedAt
                │
                ├── T_event > updatedAt → PROCEED (more recent change)
                │
                └── T_event ≤ updatedAt → SKIP (stale change)
```

### Timestamps by Entity

| Entity          | HubSpot Field             | SAP Field                          |
|----------------|---------------------------|------------------------------------|
| Contact        | `lastmodifieddate`        | `LastChangeDate + LastChangeTime`  |
| Company        | `hs_lastmodifieddate`     | `LastChangeDate + LastChangeTime`  |
| Deal           | `hs_lastmodifieddate`     | `LastChangeDateTime`               |

> **Critical note:** Contact uses `lastmodifieddate` (WITHOUT `hs_` prefix), because `hs_lastmodifieddate` returns `null` in API v3 GET list. This was verified in production.

---

## External API Adapters

### SAP S/4HANA OData v2

| Feature           | Detail                                                       |
|-------------------|--------------------------------------------------------------|
| **Base URL**      | `https://my426851-api.s4hana.cloud.sap/sap/opu/odata/sap`   |
| **Auth**          | Basic Auth (user: `CPI_INTEGRATIONS`)                        |
| **CSRF**          | HEAD with `x-csrf-token: fetch`, cached 25 min               |
| **Retry 403**     | Invalidates CSRF → refreshes → retries once                  |
| **PATCH**         | Requires prior GET for ETag + `If-Match` header              |
| **PATCH Response**| 204 No Content                                                |
| **Timeout**       | 30 seconds                                                    |
| **Limitation**    | `$expand` does NOT work with `$select`                        |

**APIs used:**
- `API_BUSINESS_PARTNER/A_BusinessPartner` — Contacts and Companies
- `API_SALES_ORDER_SRV/A_SalesOrder` — Sales Orders

### HubSpot CRM API v3

| Feature           | Detail                                                |
|-------------------|-------------------------------------------------------|
| **Base URL**      | `https://api.hubapi.com`                               |
| **Auth**          | Bearer Token (Private App)                             |
| **Retry 429**     | Reads `Retry-After`, waits and retries (max 3 times)  |
| **PATCH Response**| 200 with complete updated object body                  |
| **Timeout**       | 15 seconds                                             |
| **Webhooks**      | HMAC-SHA256 v3 signature with `CLIENT_SECRET`          |

**Endpoints used:**
- `/crm/v3/objects/contacts` — Contacts
- `/crm/v3/objects/companies` — Companies
- `/crm/v3/objects/deals` — Deals
- `/crm/v3/objects/{type}/{id}/associations/{toType}` — Associations
- `/crm/v4/objects/{type}/{id}/associations/{toType}` — Associations v4

---

## Job Queue (BullMQ)

### Configuration

| Parameter           | Value                                           |
|--------------------|-------------------------------------------------|
| Queue name         | `hubspot-sap-sync`                               |
| Backend            | Redis 7 (Railway)                                |
| Concurrency        | 1 (serial, prevents race conditions)             |
| Rate limit         | 10 jobs / 60 seconds                             |
| Max attempts       | `MAX_RETRY_ATTEMPTS` (default: 5)                |
| Backoff            | Exponential, 1 second base                       |
| Completed cleanup  | Keeps last 1,000                                 |
| Failed cleanup     | Keeps last 5,000                                 |

### Deduplication

Each job has a unique ID generated as `{entityType}-{objectId}-{occurredAt}`, preventing the same event from being processed twice if HubSpot sends duplicate webhooks.

### Failure Persistence

When a job permanently fails (exhausted retries), it's recorded in the PostgreSQL `retry_job` table for:
- Manual error diagnosis.
- Potential future reprocessing.
- Reliability metrics.

---

## Routes and Middleware

### Endpoints

| Method | Route                  | Middleware              | Description                         |
|--------|------------------------|-------------------------|-------------------------------------|
| GET    | `/health`              | None                    | Health check: `{ status, timestamp, uptime }` |
| POST   | `/webhooks/hubspot`    | `verifyHubSpotSignature`| Receives HubSpot webhooks           |

### Webhook Security

1. **express.raw()** processes the body as Buffer (required for HMAC calculation).
2. **Anti-replay:** Rejects requests with timestamp older than 5 minutes.
3. **HMAC-SHA256 v3:** `hash = HMAC(METHOD + URL + BODY + TIMESTAMP, SECRET)`.
4. **timingSafeEqual:** Constant-time comparison (prevents timing attacks).

---

## Services

### SyncService (Orchestrator)

Responsibility: coordinate the entire HubSpot → SAP synchronization flow.

| Function                    | Responsibility                                       |
|----------------------------|------------------------------------------------------|
| `syncHubSpotToSap(event)`  | Orchestrates: lock → read → map → write → log → unlock |
| `resolveCompanyForDeal()`   | Verifies Company exists before creating SalesOrder    |

### MapperService (Transformer)

Responsibility: pure functions that transform data between formats.

| Function                    | Input → Output                             |
|----------------------------|--------------------------------------------|
| `createContactPayload()`   | HS Contact → SAP BP Create payload         |
| `updateContactPayload()`   | HS Contact → SAP BP Update payload         |
| `sapBPToContactUpdate()`   | SAP BP → HS Contact properties             |
| `createCompanyPayload()`   | HS Company → SAP BP Create payload         |
| `updateCompanyPayload()`   | HS Company → SAP BP Update payload         |
| `sapBPToCompanyUpdate()`   | SAP BP → HS Company properties             |
| `createDealPayload()`      | HS Deal → SAP SO Create payload            |
| `updateDealPayload()`      | HS Deal → SAP SO Update payload            |
| `salesOrderToDealUpdate()` | SAP SO → HS Deal properties                |

### ConflictService (LWW)

Responsibility: determine if an event is more recent than the last sync.

| Function                   | Use                                               |
|---------------------------|---------------------------------------------------|
| `evaluateHubSpotEvent()`  | Compares HS event timestamp vs last sync          |
| `evaluateSapBPEvent()`    | Parses BP LastChangeDate+Time                     |
| `evaluateSapSOEvent()`    | Parses SalesOrder LastChangeDateTime               |

### SapPollerService (Polling)

Responsibility: detect changes in SAP and propagate to HubSpot.

| Function                     | Responsibility                                      |
|-----------------------------|-----------------------------------------------------|
| `startSapPoller()`          | Starts interval every 5 min (30s initial delay)     |
| `stopSapPoller()`           | Stops the interval                                   |
| `pollBusinessPartners()`    | Queries modified BPs, syncs each one                 |
| `pollSalesOrders()`         | Queries modified SOs, syncs each one                 |
| `syncBPToHubSpot(bp)`       | Anti-loop + hash + map + patch + associations        |
| `syncSalesOrderToHubSpot()` | Similar for Deals                                    |

---

## Database and Repositories

### Prisma 7 + PostgreSQL 16

Prisma ORM handles migrations and data access. Migrated from Prisma 5 to Prisma 7 due to Node.js 24 incompatibility.

### Tables

| Table       | Purpose                                  | Operations       |
|------------|------------------------------------------|------------------|
| `id_map`   | HS↔SAP ID mapping + sync locks          | CRUD + lock/unlock|
| `sync_log` | Immutable synchronization audit log      | INSERT + READ only|
| `retry_job`| BullMQ failed job persistence            | CRUD              |

---

## Tests

### Summary

| Metric           | Value           |
|-----------------|-----------------|
| Framework       | Vitest 4         |
| Total tests     | 307+             |
| Test files      | 24               |
| Coverage        | All modules      |

### Breakdown by Module

| Test File                            | Module Under Test            | Type                    |
|--------------------------------------|------------------------------|-------------------------|
| `health.test.ts`                     | GET /health                  | Integration (Supertest) |
| `env.test.ts`                        | Env var validation           | Unit                    |
| `auth.middleware.test.ts`            | HMAC-SHA256 verification     | Unit                    |
| `error.middleware.test.ts`           | Error handling               | Unit                    |
| `hubspot.client.test.ts`            | HubSpot Axios client         | Unit (mocks)            |
| `sap.client.test.ts`                | SAP Axios client             | Unit (mocks)            |
| `hubspot.routes.test.ts`            | Webhook routes               | Integration             |
| `hubspot.routes-extended.test.ts`    | Webhook routes (110+ tests)  | Extended integration    |
| `sync.service.test.ts`              | Sync orchestrator            | Unit (mocks)            |
| `sync.service-extended.test.ts`      | Sync with associations       | Extended unit           |
| `mapper.service.test.ts`            | Data transformations         | Unit                    |
| `mapper.service-extended.test.ts`    | Mapper (110+ tests)          | Extended unit           |
| `conflict.service.test.ts`          | Last-Write-Wins              | Unit                    |
| `sap-poller.service.test.ts`        | SAP→HS polling               | Unit (mocks)            |
| `sap-poller-extended.test.ts`        | Poller associations/dedup    | Extended unit           |
| `sync.queue.test.ts`                | BullMQ queue                 | Unit (mocks)            |
| `sync.worker.test.ts`               | BullMQ worker                | Unit (mocks)            |
| `sync.worker-extended.test.ts`       | Worker behavior              | Extended unit           |
| `idmap.repository.test.ts`          | id_map repository            | Unit (mocks)            |
| `synclog.repository.test.ts`        | sync_log repository          | Unit (mocks)            |
| `retryjob.repository.test.ts`       | retry_job repository         | Unit (mocks)            |
| `prisma.client.test.ts`             | Prisma singleton             | Unit                    |
| `webhook.schemas.test.ts`           | Zod webhook validation       | Unit                    |

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npx vitest

# Run a specific test file
npx vitest run tests/mapper.service.test.ts
```

---

## Environment Variables

### `.env` File

```env
# ─── Database ───
DATABASE_URL=postgresql://user:pass@host:5432/db

# ─── Redis (BullMQ) ───
REDIS_URL=redis://default:pass@host:6379

# ─── HubSpot ───
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxx
HUBSPOT_CLIENT_SECRET=xxxx              # For webhook signature verification

# ─── SAP S/4HANA ───
SAP_BASE_URL=https://my426851-api.s4hana.cloud.sap/sap/opu/odata/sap
SAP_USERNAME=CPI_INTEGRATIONS
SAP_PASSWORD=xxxx

# ─── SAP Constants ───
SAP_COMPANY_CODE=4610
SAP_BP_GROUPING=BP02
SAP_CORRESPONDENCE_LANGUAGE=ES
SAP_BP_ROLES=FLCU00,FLCU01
SAP_DEFAULT_PAYMENT_TERMS=NT30
SAP_RECONCILIATION_ACCOUNT=12120100
SAP_TAX_TYPE=CO3
SAP_SALES_ORDER_TYPE=OR
SAP_SALES_ORGANIZATION=4601
SAP_DISTRIBUTION_CHANNEL=CF
SAP_ORGANIZATION_DIVISION=10
SAP_MATERIAL=Q01
SAP_MATERIAL_UNIT=L
SAP_DEFAULT_CURRENCY=CLP
SAP_DEFAULT_COUNTRY=CL

# ─── Runtime ───
PORT=3000
NODE_ENV=development
SYNC_LOCK_TIMEOUT_MS=30000
MAX_RETRY_ATTEMPTS=5
SAP_POLL_INTERVAL_MS=300000
```

### Validation

All variables are validated at startup using a **Zod** schema in `src/config/env.schema.ts`. If any variable is missing or has an invalid format, the process terminates with a formatted error message indicating exactly which variable failed and why.

---

## Available Scripts

```bash
# Development with hot-reload
npm run dev

# Compile TypeScript to JavaScript
npm run build

# Run in production (requires prior build)
npm start

# Run tests
npm test

# Linter
npm run lint

# Format code
npm run format

# Prisma migrations
npx prisma migrate dev     # Development (creates/applies migrations)
npx prisma migrate deploy  # Production (applies pending migrations)
npx prisma generate        # Generates the Prisma client
```

---

## Configuration and Tooling

### TypeScript (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "**/*.test.ts", "src/scripts"]
}
```

### Prettier (`.prettierrc`)

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Vitest (`vitest.config.ts`)

```typescript
{
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
}
```

### Railway (`railway.toml`)

```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
startCommand = "npm run start"
```

---

## Deployment

### Railway (Production)

The project deploys on **Railway** with three services:

1. **Node.js App:** The main Express application.
2. **PostgreSQL 16:** Relational database (id_map, sync_log, retry_job).
3. **Redis 7:** BullMQ backend (job queue).

### Deploy Process

1. Push to `main` on GitHub.
2. Railway detects the change and runs Nixpacks build (`npm run build`).
3. Executes `npm run start` (`node dist/index.js`).
4. The app validates environment variables with Zod at startup.
5. Connects to PostgreSQL and Redis.
6. Starts Express, BullMQ Worker, and SAP Poller.

### Graceful Shutdown

On receiving `SIGTERM` or `SIGINT`:
1. Stops the SAP Poller.
2. Closes the BullMQ Worker (waits for in-progress jobs).
3. Closes the BullMQ Queue.
4. Closes the Express server.
5. Process terminates cleanly.

---

## SAP Production Constants

```typescript
SalesOrderType        = "OR"        // Standard Sales Order
SalesOrganization     = "4601"      // Química Sur sales organization
DistributionChannel   = "CF"        // Distribution channel
OrganizationDivision  = "10"        // Division
Material              = "Q01"       // Default material
MaterialUnit          = "L"         // Unit: Liters
CompanyCode           = "4610"      // SAP company code
BPGrouping            = "BP02"      // Business Partner grouping
Roles                 = ["FLCU00", "FLCU01"]  // Customer roles
PaymentTerms          = "NT30"      // Payment terms: Net 30 days
ReconciliationAccount = "12120100"  // Reconciliation account
CorrespondenceLanguage= "ES"        // Spanish
BPTaxType             = "CO3"       // Chilean RUT tax type
```

---

## Verified Production Findings

### SAP

1. **Phone numbers:** Do NOT include country code in `PhoneNumber`. Use separate `DestinationLocationCountry` field. Generates Warning T5/194 if included.
2. **Email/Phone/Mobile:** Are Address sub-entities with composite key: `AddressID + Person + OrdinalNumber`.
3. **`$expand` does NOT work with `$select`** in OData v2 — must use one or the other.
4. **`LastChangeDate` is null** until the first PATCH (populated afterward).
5. **Different ETag formats:** BP = plain string, SalesOrder = `W/"datetimeoffset'...'"`.
6. **`TotalNetAmount` is READ-ONLY** in SalesOrder (calculated from items).
7. **PATCH returns 204** with no body — cannot directly verify the result.
8. **Verified minimum BP payload:** Category, Grouping, Name, Language, Address(Street, City, Country, Language, PostalCode), Tax(CO3), Roles(FLCU00+FLCU01), CustomerCompany(CC, PT, RA). Do NOT include Language in CustomerCompany.
9. **`BusinessPartnerIDByExtSystem`** (max 20 characters) — field to store HubSpot ID in SAP.

### HubSpot

1. **Contact** uses `lastmodifieddate` (WITHOUT `hs_` prefix), because `hs_lastmodifieddate` returns `null` in GET list.
2. **Company and Deal** DO use `hs_lastmodifieddate`.
3. **PATCH returns 200** with complete updated object body — useful for result verification.

---

## License

Private — Química Sur / DevPym. All rights reserved.
