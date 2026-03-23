## Stack instalado 

---

### Runtime y lenguaje

**Node.js v24**
Es el motor que ejecuta tu código JavaScript/TypeScript en el servidor. Sin Node.js, tu programa no corre. Es el equivalente a la JVM en Java.

**TypeScript 5**
Es JavaScript con tipos. En tu proyecto es crítico porque los datos que viajan entre HubSpot y SAP tienen estructuras complejas — TypeScript te avisa en tiempo de desarrollo si estás enviando un campo incorrecto o de tipo equivocado, antes de que el error llegue a producción.

---

### Servidor HTTP

**Express 4**
Es el framework que recibe las llamadas entrantes. En tu proyecto tiene dos usos concretos:
- Recibir los **webhooks de HubSpot** cuando un contacto, empresa o deal cambia
- Exponer el endpoint **`GET /health`** que Railway usa para saber si tu servidor está vivo

---

### Comunicación con APIs externas

**Axios 1**
Es el cliente HTTP que hace las llamadas salientes. Tu proyecto lo usa para:
- Llamar a la **API de HubSpot** (leer/escribir contactos, empresas, deals)
- Llamar a la **API OData de SAP** (leer/escribir Business Partners y Sales Orders)
- Manejar el **CSRF token de SAP** mediante interceptores

---

### Validación de datos

**Zod 3**
Valida que los datos que llegan tienen la forma correcta antes de procesarlos. En tu proyecto valida:
- El payload del webhook de HubSpot antes de procesarlo
- La respuesta de SAP antes de mapearla a HubSpot
- Las variables de entorno al arrancar el servidor

Si SAP devuelve un campo vacío que no debería estarlo, Zod lo detecta y lanza un error controlado en lugar de que el programa falle silenciosamente.

---

### Cola de trabajos

**BullMQ 5**
Gestiona los trabajos que deben reintentarse si fallan. En tu proyecto es esencial porque:
- Si HubSpot envía un webhook y SAP está caído, BullMQ guarda el trabajo y lo reintenta con **backoff exponencial** (espera 1s, luego 2s, luego 4s...)
- Procesa los trabajos de forma ordenada evitando sobrecargar SAP
- Persiste los trabajos en Redis para que sobrevivan reinicios del servidor

**Redis 7** (se instala en Railway)
Es la base de datos en memoria donde BullMQ guarda la cola de trabajos. Sin Redis, BullMQ no funciona.

---

### Base de datos

**Prisma 7**
Es el ORM que conecta tu código con PostgreSQL. En tu proyecto maneja tres tablas críticas:
- **`id_map`** — guarda la relación entre IDs de HubSpot e IDs de SAP (ej: el contacto `123` de HubSpot es el Business Partner `BP-456` de SAP)
- **`sync_log`** — registra cada sincronización realizada para auditoría
- **`retry_job`** — registra los trabajos fallidos y sus reintentos

Sin estas tablas, si un contacto se crea en HubSpot y luego se modifica, el sistema no sabría qué Business Partner actualizar en SAP.

**PostgreSQL 16** (se instala en Railway)
Es la base de datos relacional donde viven las tres tablas anteriores.

---

### Variables de entorno

**dotenv 16**
Lee el archivo `.env` y carga las variables en tu programa. En tu proyecto almacena credenciales que **nunca van al repositorio**: el token de HubSpot, las credenciales de SAP, la URL de PostgreSQL y el secreto HMAC para validar webhooks.

---

### Testing

**Vitest 4**
Es el framework de tests. En tu proyecto verifica que cada componente funciona correctamente antes de hacer push — por ejemplo, que el mapper transforma correctamente un contacto de HubSpot al formato de Business Partner de SAP.

**Supertest**
Permite hacer llamadas HTTP reales a tu servidor Express dentro de los tests, sin necesidad de tenerlo corriendo manualmente.

---

### Calidad de código

**ESLint 9**
Analiza tu código buscando errores y malas prácticas antes de que ejecutes el programa. En tu proyecto está configurado para TypeScript estricto.

**Prettier 3**
Formatea el código automáticamente con reglas consistentes — indentación, comillas simples, punto y coma. Evita discusiones de estilo en el equipo.

---

### Resumen visual del flujo

```
HubSpot webhook → Express → Zod (valida) → BullMQ (encola)
                                                ↓
                                         SyncService
                                        ↙           ↘
                               Axios → HubSpot    Axios → SAP
                                        ↘           ↙
                                      Prisma → PostgreSQL
                                     (id_map, sync_log)
```

