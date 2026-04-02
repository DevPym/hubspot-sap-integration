# Casos de Uso — Química Sur Integration Service v1.0
## Documento verificado contra código fuente · Abril 2026

---

## Índice

1. [Flujos HubSpot → SAP (vía webhooks)](#1-hubspot--sap)
2. [Flujos SAP → HubSpot (vía polling)](#2-sap--hubspot)
3. [Transformación de datos](#3-transformación-de-datos)
4. [Mecanismos de protección](#4-mecanismos-de-protección)
5. [Manejo de errores y resiliencia](#5-manejo-de-errores-y-resiliencia)
6. [Seguridad](#6-seguridad)
7. [Operaciones y monitoreo](#7-operaciones-y-monitoreo)
8. [Casos borde y limitaciones](#8-casos-borde-y-limitaciones)

---

## 1. HubSpot → SAP

Trigger: HubSpot envía webhooks HTTP POST al endpoint `/webhooks/hubspot`. El middleware responde 200 en <5s y encola el procesamiento asíncrono en BullMQ.

### 1.1 Contact → Business Partner Persona (Category=1)

**CU-01 · Crear contacto en SAP cuando se crea en HubSpot**
- Evento: `contact.creation` o `contact.propertyChange` (primer webhook de un Contact sin mapping en `id_map`)
- Flujo: Webhook → Encolar → Worker obtiene datos completos del Contact vía GET HubSpot API → Mapper transforma a BP Persona → POST `/API_BUSINESS_PARTNER/A_BusinessPartner` → SAP retorna BP ID → Crear registro en `id_map` (hubspotId ↔ sapId) → Sync sub-entities (address, email, phone, mobile en requests separados) → Writeback `id_sap` a HubSpot
- Campos sincronizados: firstname→FirstName, lastname→LastName, address→StreetName, city→CityName, state→Region, zip→PostalCode, country→Country, comuna→District, email→EmailAddress, phone→PhoneNumber (tipo 1), mobilephone→MobilePhoneNumber (tipo 3), salutation→FormOfAddress
- Constantes inyectadas: BusinessPartnerCategory=1, BusinessPartnerGrouping=BP02, CorrespondenceLanguage=ES, Roles FLCU00+FLCU01, CompanyCode=4610, PaymentTerms=NT30, ReconciliationAccount=12120100, TaxType=CO3
- Verificado en producción: BP 100000091, 100000093, 100000095

**CU-02 · Actualizar contacto en SAP cuando cambia en HubSpot**
- Evento: `contact.propertyChange` (Contact ya tiene mapping en `id_map`)
- Flujo: Verificar anti-bucle → Verificar Last-Write-Wins → Activar lock → GET HubSpot datos completos → Mapper genera payload parcial → GET ETag del BP → PATCH `/A_BusinessPartner('{sapId}')` con If-Match → Sync sub-entities (address, email, phone, mobile) → Liberar lock → Log SUCCESS
- Si el anti-bucle está activo (sync iniciada por SAP recientemente): se descarta con status SKIPPED
- Si LWW determina que el evento es viejo: se descarta con status SKIPPED

### 1.2 Company → Business Partner Organización (Category=2)

**CU-03 · Crear empresa en SAP cuando se crea en HubSpot**
- Evento: `company.creation` o `company.propertyChange` (primer webhook)
- Validación previa: el mapper verifica que `name` exista. Si no existe (ej: Companies auto-creadas por HubSpot), lanza error descriptivo sin enviar a SAP
- Flujo: Idéntico a CU-01 pero con campos de organización
- Campos sincronizados: name→OrganizationBPName1, razon_social→OrganizationBPName2, name(truncado)→SearchTerm1, rut_empresa(dígitos)→SearchTerm2+BPTaxNumber, address→StreetName, city→CityName, state→Region, zip→PostalCode, country→Country, comuna→District, phone→PhoneNumber, condicion_venta→PaymentTerms
- Incluye: to_CustomerSalesArea (SalesOrg=4601, DistCh=CF, Div=10, Currency=CLP) para habilitar SoldToParty
- Verificado en producción: BP 100000090, 100000094

**CU-04 · Actualizar empresa en SAP cuando cambia en HubSpot**
- Evento: `company.propertyChange`
- Flujo: Idéntico a CU-02 pero con campos de organización
- Verificado en producción: address y phone actualizados en BP 100000090

### 1.3 Deal → SalesOrder

**CU-05 · Crear orden de venta en SAP cuando se crea un Deal en HubSpot**
- Evento: `object.creation` o `deal.propertyChange` (primer webhook del Deal)
- Dependencia: La Company asociada al Deal DEBE existir previamente en `id_map`. Si no existe, el worker lanza `MissingDependencyError` y BullMQ reintenta con backoff exponencial (1s, 2s, 4s, 8s, 16s) dando tiempo a que la Company se sincronice primero
- Flujo: GET Deal de HubSpot → Obtener asociaciones Deal→Company → Buscar Customer# de la Company en `id_map` → Mapper genera payload SalesOrder → POST `/API_SALES_ORDER_SRV/A_SalesOrder` → SAP retorna SalesOrder ID → Crear mapping en `id_map` → Writeback `id_sap` a HubSpot
- Campos sincronizados: orden_de_compra_o_contratoo→PurchaseOrderByCustomer, fecha_de_entrega→RequestedDeliveryDate, condicion_de_pago→CustomerPaymentTerms, Company asociada→SoldToParty
- Constantes: SalesOrderType=OR, SalesOrganization=4601, DistributionChannel=CF, OrganizationDivision=10, TransactionCurrency=CLP, Material=Q01, MaterialUnit=L
- Item creado automáticamente con el material genérico Q01
- Verificado en producción: SalesOrder 64

**CU-06 · Actualizar orden de venta en SAP cuando cambia el Deal**
- Evento: `deal.propertyChange`
- Campos actualizables: orden_de_compra_o_contratoo→PurchaseOrderByCustomer, fecha_de_entrega→RequestedDeliveryDate, condicion_de_pago→CustomerPaymentTerms
- Nota: `amount` NO se envía a SAP (TotalNetAmount es READ-ONLY, calculado desde items)

### 1.4 Asociaciones

**CU-07 · Asociación Deal↔Company dispara re-sync del Deal**
- Evento: `object.associationChange` donde fromObjectTypeId/toObjectTypeId son Deal(0-3) y Company(0-2)
- Flujo: El webhook detecta que es una asociación Deal↔Company → Encola un job de sync para el Deal → El worker procesa el Deal con la nueva Company asociada → Si el Deal ya existe en SAP, puede actualizar el SoldToParty
- Asociaciones eliminadas se ignoran en v1

**CU-08 · Eventos de asociación no soportados se descartan**
- Evento: `object.associationChange` que no sea Deal↔Company (ej: Contact↔Company, Deal↔Contact)
- Resultado: Se loguea como "saltado" y se responde 200 a HubSpot

### 1.5 Writeback de ID SAP

**CU-09 · Escribir el ID de SAP de vuelta en HubSpot**
- Después de cada CREATE exitoso, el middleware escribe la propiedad `id_sap` en el objeto HubSpot correspondiente
- Contact/Company: `id_sap` = BusinessPartner number
- Deal: `id_sap` = SalesOrder number
- Si el writeback falla, NO bloquea la sync principal (solo se loguea warning)

---

## 2. SAP → HubSpot

Trigger: Un poller consulta SAP cada 5 minutos (configurable via `SAP_POLL_INTERVAL_MS`) buscando BPs y SalesOrders modificados desde la última consulta.

### 2.1 Business Partner Persona → Contact

**CU-10 · Actualizar contacto en HubSpot cuando se modifica en SAP**
- Flujo: Poller consulta `/A_BusinessPartner?$filter=LastChangeDate gt datetime'...'` → Para cada BP modificado: buscar en `id_map` → Verificar anti-bucle → Verificar deduplicación por hash → GET Address completo del BP → Mapper transforma a HubSpot properties → Activar lock → PATCH `/crm/v3/objects/contacts/{id}` → Liberar lock → Log SUCCESS
- Si el BP no tiene mapping en `id_map`: se ignora (fue creado directo en SAP, no es responsabilidad del middleware)
- Si los datos son idénticos al último sync (hash match): se ignora sin generar tráfico a HubSpot

**CU-11 · Re-sincronizar asociación Contact↔Company desde SAP**
- Si el BP tiene `NaturalPersonEmployerName`, el poller busca una Company en HubSpot con ese nombre y crea la asociación Contact→Company si no existe

### 2.2 Business Partner Organización → Company

**CU-12 · Actualizar empresa en HubSpot cuando se modifica en SAP**
- Flujo: Idéntico a CU-10 pero con campos de organización
- Campos sincronizados: OrganizationBPName1→name, OrganizationBPName2→razon_social, Address→address/city/zip/country/state/comuna, Phone→phone, RUT→rut_empresa

### 2.3 SalesOrder → Deal

**CU-13 · Actualizar Deal en HubSpot cuando se modifica la SalesOrder**
- Flujo: Poller consulta `/A_SalesOrder?$filter=LastChangeDateTime gt datetimeoffset'...'` → Buscar en `id_map` → Mapper transforma → PATCH Deal en HubSpot
- Campos sincronizados: PurchaseOrderByCustomer→orden_de_compra_o_contratoo, TotalNetAmount→amount, RequestedDeliveryDate→fecha_de_entrega, CustomerPaymentTerms→condicion_de_pago, to_Text[0001]→dealname, RequestedQuantity del primer item→cantidad
- `amount` SÍ se sincroniza de SAP→HubSpot (SAP es la fuente de verdad del monto)

**CU-14 · Re-sincronizar asociación Deal↔Company desde SAP**
- Si la SalesOrder tiene `SoldToParty`, el poller busca ese Customer# en `id_map`, obtiene el hubspotId de la Company, y verifica/crea la asociación Deal↔Company en HubSpot usando la API v4 de asociaciones

### 2.4 Deduplicación por hash

**CU-15 · No reenviar datos idénticos a HubSpot**
- El poller mantiene un cache en memoria de SHA-256 hashes de los datos enviados
- Si el hash de los datos actuales coincide con el último envío, se omite el PATCH a HubSpot
- Evita actualizaciones innecesarias y reduce consumo de API rate limit

---

## 3. Transformación de datos

### 3.1 Conversiones de formato

**CU-16 · Normalizar país a código ISO alpha-2**
- HubSpot puede enviar "Chile", "chile", "CL", "cl" → SAP recibe "CL"
- Diccionario de 16 países con variantes en español, inglés, con/sin tildes
- Si no se reconoce → default "CL" (Química Sur es chilena) + warning en log

**CU-17 · Normalizar región chilena a código SAP**
- HubSpot envía texto libre ("Región Metropolitana", "Valparaíso") → SAP recibe código ("RM", "VS")
- 16 regiones de Chile con variantes: con/sin tilde, números romanos, abreviaciones
- Si no se reconoce → se omite del payload (SAP acepta Region vacío) + warning en log

**CU-18 · Formatear RUT para SAP**
- HubSpot: "76.123.456-7" (formato display chileno) → SAP: "761234567" (solo dígitos para BPTaxNumber y SearchTerm2)
- Reverso SAP→HubSpot: "761234567" → "76.123.456-7"

**CU-19 · Convertir fechas ISO ↔ OData v2 epoch**
- HubSpot: "2026-06-30T00:00:00.000Z" → SAP: "/Date(1751241600000)/"
- Reverso: "/Date(1751241600000)/" → "2026-06-30"

**CU-20 · Mapear Salutation ↔ FormOfAddress**
- HubSpot: "Sra.", "Sr.", "Dr." → SAP: "0002", "0001", "0003"
- Reverso incluido

**CU-21 · Mapear condición de pago (enum español ↔ código SAP)**
- HubSpot Deal: "30 días", "60 días", "Pago contado" → SAP: "NT30", "NT60", etc.
- HubSpot Company: `condicion_venta` acepta código directo "NT30"

**CU-22 · Truncar campos a límites SAP**
- OrganizationBPName: máximo 40 chars
- SearchTerm: máximo 20 chars
- PurchaseOrderByCustomer: máximo 35 chars
- BusinessPartnerIDByExtSystem: máximo 20 chars

---

## 4. Mecanismos de protección

### 4.1 Anti-bucle

**CU-23 · Prevenir bucles infinitos de sincronización**
- Escenario: HubSpot cambia Contact → Middleware escribe en SAP → SAP reporta cambio → Middleware escribe en HubSpot → HubSpot dispara webhook → Middleware escribe en SAP → ...
- Solución: Al iniciar sync, se activa un lock en `id_map` con `syncInProgress=true`, `syncInitiatedBy=HUBSPOT|SAP`, y `syncStartedAt=now()`
- Si llega un evento del sistema OPUESTO mientras el lock está activo (< 30 segundos), se descarta como eco con status SKIPPED
- El lock se libera siempre en el bloque `finally` (éxito o error)

**CU-24 · Timeout de lock anti-bucle**
- Si la sync falla sin liberar el lock (ej: crash), el lock expira automáticamente después de 30 segundos (configurable via `SYNC_LOCK_TIMEOUT_MS`)
- Previene deadlocks permanentes

### 4.2 Last-Write-Wins

**CU-25 · Resolver conflictos por timestamp**
- Cuando llega un evento de HS o SAP, se compara el timestamp del evento (`occurredAt` o `LastChangeDateTime`) contra `id_map.updatedAt`
- Si el evento es más viejo que la última sync → se descarta con status SKIPPED
- Si es más nuevo → se procesa normalmente

---

## 5. Manejo de errores y resiliencia

### 5.1 Cola de reintentos (BullMQ)

**CU-26 · Reintentar automáticamente en caso de error transitorio**
- Si un job falla, BullMQ lo reintenta hasta 5 veces (configurable via `MAX_RETRY_ATTEMPTS`)
- Backoff exponencial: 1s → 2s → 4s → 8s → 16s
- Rate limiter: máximo 10 jobs por minuto para no saturar APIs

**CU-27 · MissingDependencyError para Deal sin Company**
- Si el Deal necesita una Company que aún no está en `id_map`, el sync lanza `MissingDependencyError`
- BullMQ reintenta el job con backoff, dando tiempo a que la Company se sincronice
- En logs se muestra como error retriable, no como fallo definitivo

**CU-28 · Agotar reintentos (exhausted)**
- Si después de 5 intentos el job sigue fallando → se marca como exhausted
- Se registra en tabla `retry_job` con `exhausted=true`
- Log: "💀 Job X exhausted — no más reintentos"

### 5.2 Errores de APIs externas

**CU-29 · SAP retorna 403 (CSRF token expirado)**
- El interceptor Axios detecta 403 automáticamente → Refresca el CSRF token via HEAD request → Reintenta el request original
- Transparente para el caller

**CU-30 · SAP retorna 412 (ETag mismatch)**
- `patchWithETag()` hace GET previo para obtener el ETag actual → PATCH con If-Match
- Si entre el GET y el PATCH otro proceso modificó el recurso (412), el error sube al worker para reintento

**CU-31 · HubSpot retorna 429 (rate limit)**
- El cliente HubSpot detecta 429 → Espera el tiempo indicado en el header `Retry-After` → Reintenta
- Rate limiter de BullMQ (10/min) previene que se llegue al 429 frecuentemente

**CU-32 · HubSpot retorna 400 por email duplicado (SAP→HubSpot)**
- En el poller, si el PATCH a HubSpot falla porque el email ya existe en otro Contact → reintenta sin el campo email
- Los demás campos sí se sincronizan correctamente

**CU-33 · Writeback a HubSpot falla**
- Si el writeback de `id_sap` falla → solo se loguea warning, NO bloquea la sync principal
- El BP/SalesOrder ya fue creado exitosamente en SAP

**CU-34 · Error en sub-entities no bloquea sync principal**
- Si la sincronización de email, teléfono, móvil o address falla → se loguea warning
- El BP/header principal ya fue creado/actualizado exitosamente
- Las sub-entities se reintentan en el siguiente webhook/poll

---

## 6. Seguridad

**CU-35 · Validación HMAC-SHA256 de webhooks**
- Cada request a `/webhooks/hubspot` se verifica con firma HMAC-SHA256 usando `HUBSPOT_CLIENT_SECRET`
- HubSpot API v3 incluye header `x-hubspot-signature-v3` con timestamp + hash del body
- Si la firma no coincide → 401 Unauthorized

**CU-36 · Protección anti-replay en webhooks**
- El middleware verifica que el timestamp del webhook no tenga más de 5 minutos de antigüedad
- Previene ataques de replay con requests capturados

**CU-37 · Basic Auth para SAP**
- Credenciales transmitidas solo sobre HTTPS
- Username/password almacenados en variables de entorno de Railway (nunca en código)

**CU-38 · CSRF Token automático para SAP**
- Token se obtiene via HEAD request antes de escrituras
- Se cachea 25 minutos (TTL configurable)
- Se refresca automáticamente ante invalidación (403)

**CU-39 · Logs sin datos sensibles**
- Los payloads en `sync_log` no contienen contraseñas, tokens ni secretos
- Credenciales solo existen en variables de entorno de Railway

---

## 7. Operaciones y monitoreo

**CU-40 · Health check**
- `GET /health` retorna status 200 con estado de base de datos y Redis
- Usado por Railway para verificar que el contenedor está vivo

**CU-41 · Auditoría completa en sync_log**
- Cada evento de sincronización genera una fila inmutable en `sync_log`
- Registra: entityType, operation (CREATE/UPDATE), sourceSystem, targetSystem, status (PENDING/IN_FLIGHT/SUCCESS/FAILED/SKIPPED), payloads inbound/outbound, errorMessage, errorCode, attemptNumber
- Permite diagnóstico y trazabilidad de cada operación

**CU-42 · Mapeo de IDs en id_map**
- Tabla `id_map` mantiene la correspondencia hubspotId ↔ sapId
- Índices únicos: (entityType, hubspotId) y (entityType, sapId)
- Incluye estado del lock anti-bucle y timestamps de sync

---

## 8. Casos borde y limitaciones

### 8.1 Eventos que se descartan explícitamente

**CU-43 · Eliminaciones (object.deletion) — no sincronizadas en v1**
- HubSpot envía webhook de eliminación → se descarta con log "Saltado: deletion"
- Los registros eliminados en un sistema siguen existiendo en el otro

**CU-44 · Merges de contactos/empresas — no sincronizados en v1**
- Si HubSpot fusiona dos Contacts → se descarta el webhook de merge
- El Contact resultante de la fusión mantiene su mapping original

**CU-45 · Restauraciones (object.restore) — no sincronizadas en v1**
- Si un objeto se restaura de la papelera de HubSpot → se descarta

**CU-46 · BPs creados directamente en SAP sin origen HubSpot**
- El poller detecta el BP modificado pero al no encontrar mapping en `id_map` → lo ignora
- Solo se sincronizan BPs que fueron creados desde HubSpot

**CU-47 · Companies auto-creadas por HubSpot**
- Cuando se crea un Contact con el campo `company` (texto libre), HubSpot puede auto-crear una Company sin `name` propiamente establecido
- El mapper valida que `name` exista antes de crear el BP → si no existe, lanza error descriptivo
- Esto previene el error SAP R11/401 "Enter a value for field Name 1 of organization"

### 8.2 Limitaciones conocidas v1

**CU-48 · to_Text en SalesOrder deshabilitado**
- El `dealname` y `description` NO se sincronizan a SAP porque los LongTextIDs para VBBK no están configurados en el customizing de SAP de Química Sur
- Pendiente: consultar con equipo SAP los Text IDs válidos

**CU-49 · No se sincroniza amount de HubSpot a SAP**
- SAP calcula TotalNetAmount desde items + pricing → es READ-ONLY
- Solo se sincroniza en dirección SAP→HubSpot (TotalNetAmount → amount)

**CU-50 · Industry/Giro requiere POST separado**
- SAP nota 2834167 confirma que `to_BuPaIndustry` no se puede establecer en deep insert
- Requiere POST separado después de crear el BP → pendiente de implementar

**CU-51 · Polling no detecta creaciones en SAP**
- El poller solo busca BPs/SalesOrders modificados que ya tienen mapping en `id_map`
- Si alguien crea un BP nuevo directamente en SAP, NO se refleja en HubSpot
- Solo la dirección HubSpot→SAP soporta CREATE; SAP→HubSpot solo soporta UPDATE

**CU-52 · Concurrencia limitada a 1 worker**
- BullMQ procesa 1 job a la vez (concurrency=1) para evitar race conditions en `id_map`
- Rate limiter de 10 jobs/minuto protege las APIs externas

**CU-53 · Productos/catálogo fuera de alcance**
- El SalesOrder siempre usa el material genérico Q01 con unidad L
- No hay sincronización de catálogo de productos entre sistemas
