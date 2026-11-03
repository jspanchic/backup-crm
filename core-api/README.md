# Core API

Servicio Fastify + TypeScript sobre Node 24. Es la única puerta entre WhatsApp, el bot y la base.

- **Rutas:** `ROUTES.md`. Lo que no está ahí no existe.
- **Contrato con el bot:** `../docs/contratos/core-api-n8n.md`.
- **Esquema y permisos:** `../db/README.md`. `core-api` entra a la base como `core_api`, que solo ejecuta funciones del esquema `api`.
- **Plan:** `../docs/plan/ENTREGA_1.md`.

## Desarrollo

Con Node 24 y Docker, desde esta carpeta:

```bash
npm ci --ignore-scripts
```

```bash
npm run local:init
```

```bash
npm run local:up
```

```bash
npm run db:bootstrap
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm test
```

Las pruebas usan Postgres y PostgREST reales y una base propia (`salvionix_test`) que se crea de cero en cada corrida. `local:init` genera `../infra/local/.env` con valores aleatorios, ignorado por git.

## Qué hace hoy (CRM-T5)

| Pieza | Archivo |
|---|---|
| Webhook de WAHA: firma, duplicados, E.164, tarjetas | `src/routes/whatsapp.ts`, `src/signature.ts`, `src/waha.ts`, `src/phone.ts`, `src/redact.ts` |
| Contexto y llamada al bot, con reintento | `src/bot.ts`, `src/token.ts` |
| Cola de envío con ritmo y reintentos | `src/outbox.ts` |
| Proxy del panel hacia PostgREST, con lista cerrada | `src/routes/admin-proxy.ts` |

Las herramientas del bot (`/tools/*`) llegan con CRM-T6.
