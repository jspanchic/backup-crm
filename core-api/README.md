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
| PDF de cotización, orden de compra y orden de trabajo (CRM-T14b) | `src/documents/`, `src/routes/admin-documents.ts`, `templates/`. Cómo cambiar las plantillas: [`docs/PLANTILLAS_PDF.md`](../docs/PLANTILLAS_PDF.md). Vista previa: `npm run docs:preview` |

## Herramientas del bot (CRM-T6)

`ficha`, `guardar_datos`, `cotizar`, `escalar` y `responder`, con token de conversación y esquema estricto (`src/routes/tools.ts`). `responder` revisa el texto contra la base antes de encolarlo (`src/reply-review.ts`). Faltan las de agenda (CRM-T9) y `confirmar_titular` (CRM-T10). Detalle en `../docs/contratos/core-api-n8n.md`.

## Demo local (CRM-T11, parte sin Claude)

Simulador de WAHA (`dev/waha-sim.ts`), bot de guion (`dev/mock-bot.ts`) y el guion (`dev/demo.ts`). Todo corre en local.
Los pasos y cómo correrlo están en [`docs/DEMO.md`](../docs/DEMO.md).

| Orden | Para qué |
|---|---|
| `npm run start:demo` | El servicio con pausas cortas entre mensajes (`infra/local/demo.env`) |
| `npm run demo` | El guion completo con el bot de guion; sale con código distinto de cero si falla algo |
| `npm run demo -- --bot external` | El mismo guion contra el bot real (n8n), cuando exista |
| `npm run sim -- --phone <dígitos> --text "..." [--name ...] [--twice]` | Un mensaje suelto, firmado como lo firma WAHA |

El formato de `payload.id`, la codificación de la firma y la unidad del timestamp del simulador son **SUPUESTOS** hasta tener una captura real de WAHA.
