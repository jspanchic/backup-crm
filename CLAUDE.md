@backoffice/AGENTS.md

# Plataforma Salvionix (BYTOGAM)

Monorepo privado. `backoffice/` es un fork de Atomic CRM para Salvionix Biosafety Solutions. Producto a futuro de BYTOGAM para otros clientes: la licencia y la simplicidad importan.

Origen: `docs/auditoria/AUDITORIA_SALVIONIX_CRM_20261102.md` (con las correcciones de Sebastián del 02/11). Plan vigente: `docs/plan/ENTREGA_1.md`.

## Estructura del repo

| Carpeta | Qué es |
|---|---|
| `backoffice/` | Atomic CRM (subtree de marmelab, MIT). Cambios propios mínimos; ver `docs/UPSTREAM.md`. Tiene su propio `CLAUDE.md` y `AGENTS.md` del upstream |
| `core-api/` | Servicio Fastify + TypeScript (Entrega 1) |
| `db/` | Esquema propio y migraciones. `backoffice/supabase/` es solo referencia |
| `infra/`, `n8n/` | Compose y flujos sin secretos |
| `docs/` | Documentación en español |

## El negocio

- **Salvionix** es la empresa. **Vital Oxide** es el producto que aplica. No son lo mismo. Se vende el servicio de aplicación, no la botella.
- **Modelo "Uber de tareas":** la publicidad trae al cliente, el bot vende y genera la orden, un técnico de la zona va, aplica, cobra y se va. Hoy: Esteban en Orlando. Meta: muchas ciudades.
- **Javier** es el bot (n8n + Claude). Atiende por WhatsApp (WAHA) y SMS. Si se traba, la venta pasa a una persona.
- **El CRM es la memoria del agente.** Javier encuentra la oportunidad por el teléfono: conversación, datos, cotización, etapa y tareas.
- **Simple ("basicongo").** Los usuarios vienen de Excel. Ante la duda, quitar.
- **Dominio:** todo el desarrollo es para `bioseguridad.bytogam.com` (Caddy en el VPS), no para salvionix.com en Hostinger. El formulario de salvionix.com queda fuera. **POR DECIDIR con Joel:** dónde viven los subdominios `crm` y `api`, y si se usa Cloudflare.

### Reglas de negocio que el código debe respetar

- **Slots:** cada servicio tiene inicio, fin, dirección y técnico, está atado a un lead y **no se cruza**. La regla vive en la base, no solo en la app. Dura 1 h (valor de configuración). El bot ofrece solo horarios libres: todo está bloqueado salvo la disponibilidad declarada.
- **Números reasignados:** el teléfono cambia de dueño. Se distingue al dueño anterior, se empieza de cero y **no se pierde el historial**.
- **Leads de prueba:** nombre que empieza con "Prueba" (Prueba Sebas, Prueba Juanma). No cuenta como cliente, no entra a reportes y no bloquea la agenda.
- **Afirmaciones del producto:** Vital Oxide es un pesticida registrado. Solo se afirma lo aprobado. Ningún texto nuevo agrega afirmaciones sanitarias sin OK de JM.
- **No hay precios fijos en el código.** Los valores del prompt de Javier ($0,12 y $0,06 por pie², 7%, mínimo $150) son **ejemplos**. La cotización la calcula `core-api` (no el modelo) leyendo una **tabla configurable y versionada**. Esos valores se cargan solo como datos de ejemplo marcados "por confirmar". Lo mismo vale para la disponibilidad del técnico y el margen entre servicios: son configuración. En pruebas, datos de ejemplo.

## Compromiso con JM (dos partes)

| Entrega | Plazo | Qué es |
|---|---|---|
| **1** | ≈10 días desde el 29/10 (≈08/11) | El bot con memoria en el CRM y el calendario de slots, **funcionando** |
| **2 y 3** | 3–4 semanas desde el 29/10 (≈24/11) | El CRM completo |

No es un atraso: son dos compromisos distintos. Detalle y horas en la sección 8 de la auditoría.

## Arquitectura aprobada (29/10)

| Pieza | Decisión |
|---|---|
| CRM | Fork de Atomic CRM (MIT) |
| Servicio propio | `core-api` en TypeScript, Node 24, Fastify. Única puerta |
| Base | PostgreSQL 17 propio, separado de la base de n8n, sin puertos publicados |
| n8n | **Sin acceso a la base ni a llaves de canales.** Habla con `core-api` con un token de conversación de 15 min |
| WAHA | Red interna. Firma con HMAC hacia `core-api`. Envíos por outbox con ritmo |
| DNS / acceso | **POR DECIDIR con Joel** (Cloudflare, Tunnel, Access y subdominios `crm`/`api`). Web y FTP de salvionix.com siguen en Hostinger. bytogam.com no se toca |
| Login | Cloudflare Access para el equipo, si Joel lo confirma. Login propio recién en la fase comercial |

Mensaje: WAHA → `core-api` (firma, dedupe, tarjetas, canal y marca, guardar) → n8n (mensaje + historial + ficha + token) → tools de `core-api` → outbox → cliente.

**Proveedor de datos — POR DECIDIR (spike CRM-T1):** dataProvider delgado en carpeta nueva, que habla solo con `core-api`, el cual reenvía a un PostgREST interno con rol limitado (opción C). Respaldo: rutas `/admin/*` a medida (opción B). Supabase no va a producción. Mientras tanto, `src/components/atomic-crm/providers/supabase/` queda intacto. La decisión queda en `docs/decisiones/ADR-001-proveedor-datos.md`.

**Modelo de datos:** ver la sección 7 de la auditoría. Tablas y columnas en inglés.

**Fuera del MVP:** formulario web, SMS por `core-api`, PDFs, Camila, recompra, login propio.

## Condiciones de Joel (no negociables)

1. **Todo webhook se prueba primero en el número de pruebas de BYTOGAM.** Producción (Javier, Camila, SMS 630) no se toca hasta que funcione.
2. WAHA es multimarca: `core-api` manda cada mensaje al bot correcto. Webhook por sesión, nunca global.
3. Si se toca DNS: capturas antes y después. SSL en Full; Full (strict) al confirmar el certificado.
4. Mismo VPS como riesgo aceptado, con redes Docker separadas.

## Seguridad

- **No abrir `.env`, `.env.*`, `.hostinger-ftp` ni `sftp.json`.** Si se encuentra un secreto, indicar archivo y línea, sin copiar el valor.
- **Sin acción sin permiso de Sebastián:** SSH, SFTP o FTP, y operaciones contra n8n, WAHA, Postgres del VPS, Hostinger o Cloudflare.
- Secretos en Bitwarden; en el VPS, archivos 600 montados como `secrets` de Compose. Nunca en git, chats ni herramientas de IA. La rotación de los secretos hallados en la auditoría la hacen Sebastián y Joel.
- Nada de datos reales de clientes en fixtures, logs, prompts o tests.
- **Ninguna tool del bot recibe un id de cliente:** el contacto sale del token.
- Firma verificada sobre el cuerpo crudo y en tiempo constante. Esquema estricto en cada ruta. Ante error: respuesta genérica y ninguna acción.
- Tarjetas redactadas (Luhn) antes de guardar y antes del LLM.
- Toda ruta pública en `ROUTES.md`. Si no está en la lista, no existe.
- SQL solo con parámetros. Ningún servicio usa el rol `postgres`.
- Dependencias: lockfile, `npm ci --ignore-scripts`. `.npmrc` fija `min-release-age`: no saltarlo. **No agregar dependencias npm nuevas sin preguntar a Sebastián.**
- **Antes de sumar una dependencia o tecnología: revisar licencia y si se puede vender.** n8n tiene licencia de uso interno: no se empaqueta dentro del producto.
- Docker local solo para el spike y pruebas locales, con imágenes oficiales de versión fija y puertos en `127.0.0.1`.

## Comandos

Desde `backoffice/` (Node 24, `.nvmrc`):

```bash
npm run typecheck           # TypeScript (tsc --noEmit)
npm run test:unit:functions # tests de supabase/functions
npm run test:unit:app       # tests de la app (necesitan Chromium)
npm run lint                # ESLint
npm run build               # producción; escribe en dist/
```

```bash
npx supabase db diff --local -f <nombre>   # generar migración
npx supabase migration up --local          # aplicar
```

- Los comandos `make ...` de `backoffice/AGENTS.md` equivalen a estos scripts de npm. **En Windows no hay `make`**.
- **Nunca** `npx supabase db reset --local` ni `db push` sin pedirlo: borran datos o tocan remoto.
- El checkout de Sebastián usa los puertos 553xx (`supabase/config.toml`), no los 543xx de `backoffice/AGENTS.md`.
- Node: `.nvmrc` pide v24. En Windows, `INICIAR-CRM.cmd` usa `.tools\`.
- Hook de commits: `.githooks/pre-commit` (gitleaks, obligatorio; `git config --worktree core.hooksPath .githooks`). Las plantillas `.env` de `backoffice/` son las del upstream. El hook `.husky` del upstream llama a `make registry-gen`, que no existe en Windows: no commitear cambios de `backoffice/registry.json`.
- Los tests `app` necesitan Chromium: `make install-playwright-browsers`, solo si Sebastián lo aprueba.
- **POR DECIDIR:** comandos de `core-api` y del entorno Postgres + PostgREST.

## Convenciones

- **Idioma:** en **inglés** el código, los nombres de base de datos, los comentarios y los commits. En **español** `docs/` y este `CLAUDE.md`, y la interfaz. Con el usuario, español claro. Esta regla vale para todo el repo y prevalece sobre `backoffice/.claude/rules/english-only.md` (que viene del upstream) para `docs/` y `CLAUDE.md`.
- **Alcance:** hacer lo pedido. Lo que se encuentre al paso se reporta, no se corrige en el mismo cambio.
- **Ramas:** se trabaja y se commitea libremente en `wip/<id>` (por ejemplo `wip/crm-t4`), que **nunca se suben**. Solo con la orden "publica <ID>" de Sebastián se pasa el avance a su rama de entrega (`crm-t4-esquema`, etc.) como un commit nuevo (`git merge --squash` desde `wip`) y se hace push de esa rama. Sin esa orden no se hace push. Tareas `CRM-T0` … `CRM-T13`. Nada entra a `main` sin un PR revisado por Joel.
- **Remotos:** `origin` es `salvionix-platform` (privado). `upstream` es marmelab, con el push desactivado (`DISABLED`): **nunca** hacer push ahí. Para traer cambios del upstream: `git subtree pull --prefix=backoffice` según `docs/UPSTREAM.md`.
- **Validar en 4 pasos:** prueba local, prueba en el número de BYTOGAM, evidencia, doble check de Joel.
- **Horas:** las horas se registran en el Excel. JM paga por horas estimadas con honestidad; las perdidas por algo previsible no se facturan.
- **Documentar** cada decisión técnica en `docs/`, con archivo y línea. Marcar **SUPUESTO** lo no verificado. No inventar precios, zonas ni tiempos.
- **Workflows de n8n:** se exportan sin credenciales a `n8n/`.
- **No sacar nada del aire sin avisar:** JM puede estar presentando. Las correcciones se hacen en paralelo y se reemplazan.
- **Sebastián tiene máximo 30 h por semana** hasta diciembre. Domingo libre.

## Quién decide

| Tema | Persona |
|---|---|
| Negocio, precios, plazos, textos legales | Juan Manuel (JM) |
| Producción, infraestructura, DNS, doble check | Joel |
| Implementación y estimaciones | Sebastián |
