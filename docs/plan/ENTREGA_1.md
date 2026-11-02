# Plan de la Entrega 1 (demo funcional en local)

- **Fecha:** lunes 02/11/2026
- **Estado:** PROPUESTO. No se ha escrito código ni se ha ejecutado la integración.
- **Alcance:** todo en local, sin VPS, sin WAHA real y sin Joel. Decisión tomada: opción C ([ADR-001](../decisiones/ADR-001-proveedor-datos.md)) y destino en el monorepo de `origin/f1-b0-repo-base`.
- **Convención:** nombres de tablas, columnas, código y commits en inglés. Este documento y `docs/` en español.
- **Citas:** `[ARQ]`, `[BASE]`, `[SM]` y `[GRAB]` son las claves definidas al inicio de la auditoría. Lo no verificado se marca **SUPUESTO**.

## 1. Resumen

1. **El monorepo es un esqueleto.** `core-api/`, `db/`, `infra/` y `n8n/` solo tienen un README. Lo real es `backoffice/` (Atomic v1.6.0 del 22/09), el CI y el hook de gitleaks.
2. **Los `.env` de `backoffice/` son las plantillas del upstream:** idénticos byte a byte (sección 2.2).
3. **Estimación: 39 h base, ≈47 h con 20% de margen.** Son más que las 28,5 h de la auditoría (sección 5). A 30 h por semana, las 39 h base no caben en la semana del 08/11. La sección 5.2 dice qué recortar y cuándo decidirlo.
4. **Hay un problema causado por mi push anterior:** `origin/crm-t0-rescate` contiene toda la historia del upstream, y el CI escanea todas las ramas con gitleaks (sección 2.3).
5. **Necesito 8 decisiones tuyas** (sección 11).

## 2. Qué hay en `origin/f1-b0-repo-base`

Revisado en solo lectura, commit `c8219605`.

### 2.1 Contenido real

| Ruta | Qué hay de verdad | Consecuencia |
|---|---|---|
| `backoffice/` | 807 archivos. Atomic v1.6.0 importado con `git subtree --squash` (`git-subtree-split: da954d96`) | Es lo que reemplaza CRM-T0b |
| `core-api/` | Solo `README.md`: reservado para Fastify + TypeScript en Node 24; "no desplegar Supabase" | Se construye desde cero |
| `db/` | Solo `README.md`: migraciones propias, sin dumps ni datos de clientes | Se construye desde cero |
| `infra/` | Solo `README.md`: Compose y cloudflared; variables en `.env.example` | Va el Compose local |
| `n8n/` | Solo `README.md`: exportaciones sin credenciales, sin URLs secretas, sin datos | Sin flujos todavía |
| `.github/workflows/ci.yml` | Job `secrets` (gitleaks 8.30.1 sobre `--all`) y job `backoffice` (`npm ci --ignore-scripts`, lint, build de demo; tests `app` solo en PR a `develop` o `main`). **Acciones fijadas por SHA** | Falta un job para `core-api` y `db` |
| `.githooks/pre-commit` | Exige gitleaks; **falla si no está instalado** | `C:\CRM\.tools` no tiene gitleaks (decisión 4) |
| `.gitleaksignore` | 6 huellas de fixtures públicas, **atadas al commit `9e638504`** | Un nuevo squash cambia el commit: hay que agregar huellas |
| `.gitignore` raíz | `.env`, `.env.*` (salvo `.env.example`), `secrets/`, `*.pem`, `*.key`, `*.dump` | Sirve tal cual |
| `docs/UPSTREAM.md` | Procedimiento de subtree. **Tras cada pull hay que quitar `backoffice/.devcontainer/`** (Kaspersky marca `install.sh`). Si sale `Permission denied`, detenerse y avisar | Se aplica en CRM-T0b |
| `docs/DESARROLLO.md`, plantilla de PR | Ramas `codex/f1-b3-…` y código `F1-Bx` | **Contradice** tu convención `crm-tN`. Se actualiza en CRM-T0b |
| `LICENSE`, `NOTICE` | Código propio propietario; Atomic MIT v1.6.0 | `NOTICE` debe registrar el commit nuevo |

`main` y `develop` tienen un solo commit (`c8cee561`): `.githooks` y `.gitignore`. Todavía no reciben el monorepo.

### 2.2 Comparación de los `.env` (sin valores)

Comparé el identificador del blob de git, que cambia si cambia un solo byte.

| Archivo | Monorepo | Upstream `da954d96` | Upstream actual | `crm-t0-rescate` |
|---|---|---|---|---|
| `.env.development` | `e84a293e96` | `e84a293e96` | `e84a293e96` | `e84a293e96` |
| `.env.e2e` | `d8a84a0805` | `d8a84a0805` | `d8a84a0805` | `d8a84a0805` |
| `supabase/functions/.env` | `175d98913e` | `175d98913e` | `175d98913e` | `3907118781` (solo `SB_JWT_ISSUER`, URL local) |

**Conclusión:** `backoffice/.env.development` y `.env.e2e` son las plantillas del upstream. Contienen claves del Supabase local de ejemplo, ya revisadas en `.gitleaksignore`. Una de las variables de `.env.e2e` se llama `SERVICE_ROLE_KEY`: es del Supabase local de pruebas según esa revisión, y no debe reutilizarse en ningún despliegue.

### 2.3 Problema: `origin/crm-t0-rescate` y gitleaks

- El job `secrets` corre `gitleaks git --log-opts="--all"` con `fetch-depth: 0`, así que escanea **todas las ramas del repo**.
- `crm-t0-rescate` trae toda la historia pública de marmelab. Las fixtures del upstream aparecen ahí en otros commits, y las huellas de `.gitleaksignore` solo valen para `9e638504`.
- **Efecto esperado (SUPUESTO, no lo pude ver: no hay `gh` ni gitleaks aquí):** el próximo push que dispare `ci.yml` puede poner en rojo el job `secrets`. Mi push no lo disparó, porque esa rama trae los workflows del upstream y no este `ci.yml`.
- **No son secretos nuevos.** Es ruido de fixtures públicas, pero rompería el CI.
- **Propuesta:** borrar `origin/crm-t0-rescate` cuando se publique CRM-T0b. El trabajo queda en el monorepo y en la rama local. Es una acción remota: la hago solo con tu orden (decisión 6).

## 3. CRM-T0b · Integración al monorepo (3 h)

### 3.1 Alternativas

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **A. `git subtree --squash` + reaplicar nuestros commits** | Igual a lo que documenta `docs/UPSTREAM.md`. Conserva nuestros commits uno por uno. `git subtree pull` sigue funcionando. No trae fixtures antiguas al historial, así que gitleaks queda manejable | La historia commit a commit del upstream no queda dentro del repo (se consulta en marmelab). Nuestros commits cambian de SHA | **Recomendada** |
| B. `git subtree` sin squash | Historia completa del upstream | Miles de commits ajenos; cada fixture aparece en muchos commits y `.gitleaksignore` se vuelve inmanejable. Además, no se puede combinar limpiamente con el squash ya hecho | No |
| C. `git filter-repo --to-subdirectory-filter` y merge | Blame completo | Reescribe todos los SHA del upstream, rompe `subtree pull` y tiene el mismo problema de gitleaks | No |
| D. Submódulo con un fork privado | Separación total y pulls del upstream muy limpios | Dos repos, dos PR por cambio, CI más complejo, más trabajo para Joel | No |
| E. Copiar los archivos | Trivial | Se pierde la historia y `subtree pull` deja de tener base | No |

### 3.2 Pasos (solo cuando apruebes, en `wip/monorepo`)

1. Crear `wip/monorepo` desde `origin/f1-b0-repo-base`, en una carpeta aparte (decisión 5).
2. Traer el upstream al commit ya validado:
   ```bash
   git subtree pull --prefix=backoffice upstream 9a5cb4b9 --squash
   ```
   - **Desvío de `docs/UPSTREAM.md`:** pide una release publicada, y `9a5cb4b9` es `v1.6.0-249`. No hay release más nueva, y nuestro trabajo ya está validado sobre ese commit. Se deja registrado (decisión 7).
   - Conflicto esperado: `getContactAvatar.test.ts`, que el monorepo corrigió y el upstream cambió. Se compara y se conserva la versión que pase.
3. Quitar `backoffice/.devcontainer/` otra vez. Si Kaspersky produce `Permission denied`, me detengo y te aviso.
4. Reaplicar los 7 commits propios dentro de `backoffice/`:
   ```bash
   git format-patch 489537c3..19b8d90d --stdout > own.patch
   git am -3 --directory=backoffice own.patch
   ```
   El archivo de parches va fuera del repo. El merge con upstream no tuvo conflictos, así que espero pocos. Es un **SUPUESTO** hasta correrlo: esos parches salen de una base anterior a `9a5cb4b9`.
5. Colocar lo que no es del CRM en la raíz:

   | Hoy en `crm-t0-rescate` | Destino | Motivo |
   |---|---|---|
   | `CLAUDE.md` (parte Salvionix) | `CLAUDE.md` raíz | Es del proyecto. `backoffice/CLAUDE.md` vuelve al del upstream |
   | Excepción en `.claude/rules/english-only.md` | Regla en `CLAUDE.md` raíz | `backoffice/.claude/` vuelve al del upstream: menos conflictos |
   | `docs/auditoria/` | `docs/auditoria/` | Documentos del proyecto |
   | `docs/decisiones/ADR-001…` (de `wip/crm-t1`) | `docs/decisiones/` | Con la corrección de la sección 3.3 |
   | `FLUJO-SALVIONIX.md`, `GUIA-CRM.txt` | `docs/` | Documentos |
   | `INICIAR-CRM.cmd` | `backoffice/` | Sigue siendo el arranque con Supabase local |

6. Actualizar `.gitleaksignore` con las huellas del commit nuevo, sin exclusiones generales.
7. Actualizar `docs/UPSTREAM.md` (commit, fecha, cambios propios), `NOTICE`, `README.md`, `docs/DESARROLLO.md` y la plantilla de PR (`CRM-Tn`, `wip/`).
8. Validar: `npm ci --ignore-scripts`, typecheck, lint, tests `functions`, tests `app` y `build:demo`, igual que el CI. Luego gitleaks sobre toda la rama.

### 3.3 Correcciones que entran aquí

- **ADR-001, avatar:** el ADR culpa a la extensión `http`. Revisando el código, la causa más probable del `"ERROR"` es que `get_domain_favicon` lee `favicons_excluded_domains`, que `crm_api` no puede leer, y `get_avatar_for_email` captura la excepción. Se corrige el texto, y CRM-T4 resuelve el fondo (sección 6.5).
- **`06_grants.sql`:** ver sección 6.6.

### 3.4 Riesgos

| Riesgo | Efecto | Qué haré |
|---|---|---|
| Los tests `app` nunca corrieron sobre nuestros cambios (faltaba Chromium) y `npm run lint` tampoco | El CI los exige en PR. Pueden salir fallos en nuestro código | Corregirlos dentro de CRM-T0b. Si son muchos, te aviso antes de seguir. **Es lo que más puede mover las 3 h** |
| El hook de `.husky` pide `make`; en el monorepo el activo es `.githooks` | `registry.json` deja de regenerarse en cada commit; ya no estorba en Windows | Queda anotado. No afecta al CRM |
| Cambiar `core.hooksPath` afecta a todos los worktrees | Los commits en `C:\CRM` empezarían a exigir gitleaks | Usar configuración por worktree |

**Upstream después:** `git subtree pull --prefix=backoffice upstream <commit> --squash`, quitar `.devcontainer`, y resolver conflictos solo donde tocamos `backoffice/`. Por eso todo lo nuevo va fuera de esa carpeta salvo el proveedor.

## 4. Estructura del monorepo tras la Entrega 1

```text
backoffice/                        Atomic CRM (subtree). Cambios propios mínimos
  src/components/atomic-crm/providers/core-api/   proveedor definitivo (viene del spike)
  supabase/                        Referencia. No se despliega
core-api/
  src/                             Servicio Fastify
  dev/mock-bot.ts                  Bot simulado: misma llamada que n8n
  dev/waha-sim.ts                  Simulador de WAHA: firma y envía webhooks, recibe sendText
  dev/demo.ts                      Guion de la demo
  test/                            Pruebas de aceptación (sección 8)
  ROUTES.md                        Lista cerrada de rutas
db/
  bootstrap/                       Roles y base. Corre una vez con superusuario
  migrations/                      Migraciones propias, solo hacia adelante
  seeds/sample/                    Datos de ejemplo marcados "por confirmar"
  upstream-migrations.lock         Migraciones de Atomic ya consideradas
infra/local/docker-compose.yml     Postgres 17 y PostgREST, solo en 127.0.0.1
n8n/                               Sin cambios en esta entrega
docs/plan/, docs/decisiones/, docs/contratos/core-api-n8n.md
```

**El mock y el simulador van en `core-api/dev/`** porque comparten firma, esquemas y fixtures con las pruebas. Quedan fuera del build de producción.

## 5. Orden de trabajo y horas

Cada tarea se trabaja en `wip/crm-tN` y solo sube con "publica <ID>".

| Orden | Tarea | Qué incluye | Horas |
|---:|---|---|---:|
| 1 | **CRM-T0b** | Sección 3 | 3 |
| 2 | **CRM-T4** | Compose local, roles, capa de compatibilidad, línea base de Atomic, tablas `core`, precios, agenda, runner de migraciones, pruebas de esquema | 9 |
| 3 | **CRM-T5** | Fastify, webhook, firma, duplicados, E.164, redacción de tarjetas, resolución de marca a titular, contexto, token, llamada al bot, outbox, proxy `/admin/rest` | 8 |
| 4 | **CRM-T6** | Las 9 tools (decisión 8) con esquema estricto | 7 |
| 5 | **CRM-T9 (local)** | Disponibilidad, horarios libres, hold con vencimiento, manejo del cruce, vista de citas | 4 |
| 6 | **CRM-T10** | Número reasignado, "Prueba X", casos de teléfono | 2 |
| 7 | **CRM-T8 (panel)** | Carpeta definitiva, selección por configuración, autenticación local, lista de citas de solo lectura | 3 |
| 8 | **CRM-T11 (parte)** | Simulador, mock del bot, contrato HTTP, guion de demo, job de CI | 3 |
| | **Total base** | | **39** |
| | **Con 20% de margen** | | **≈47** |

CRM-T1 ya se hizo. Las pruebas van dentro de cada tarea, no al final. Dependencias: T0b → T4 → T5 → T6 → (T9, T10) → T8 → T11.

### 5.1 Por qué sube frente a las 28,5 h de la auditoría

| Cambio | Horas |
|---|---:|
| CRM-T0b no existía | +3 |
| Panel y proxy, antes en la Entrega 2 | +4 |
| Precios versionados y tools adicionales | +2 |
| Más pruebas de aceptación y simulador | +3 |
| Salen n8n real, VPS y sesión de WAHA (pasan a después) | ≈ −4 |
| Línea base más fina de T4, T5, T6, T9 y T10 | ≈ +2,5 |

Estos desgloses son mi estimación, no una medición.

### 5.2 ¿Cabe en el plazo?

- **Con las horas base, no.** A 30 h por semana, 39 h dan ≈8 días de trabajo: **≈11–12/11**, no el 08/11.
- **CRM-T0 y T1 tomaron bastante menos reloj que lo estimado** (ya tienes esas cifras en el chat). Puede repetirse, pero no lo doy por hecho: T4 a T6 tienen más diseño y más revisión tuya.
- **Punto de control:** al terminar CRM-T4 y T5 comparo horas reales con estimadas y te digo la fecha nueva.

**Qué recortar si vamos tarde, en este orden:**

| Recorte | Ahorra | Costo |
|---|---:|---|
| Panel directo a PostgREST en local, sin proxy (el proxy pasa a la Entrega 2) | 1 h | La demo no muestra la "única puerta". **Producción sigue exigiéndolo** |
| Citas por SQL en la demo, sin lista en el panel | 1 h | Incumple el punto 8. Solo con tu OK |
| Outbox sin ritmo ni reintentos | 0,5 h | Se agrega antes de usar WAHA real |

**No recorto:** firma, exclusión, vencimiento de token, permisos, ni las pruebas de la sección 8.

## 6. Esquema

Todo sale de `db/migrations/`. Las reglas viven en la base, no solo en la app.

### 6.1 Dónde viven las migraciones

| Pregunta | Respuesta |
|---|---|
| ¿Qué pasa con `backoffice/supabase/`? | Se queda **sin aplicar y sin editar para lo nuevo**: es referencia y sirve para el Supabase local. Coincide con `docs/UPSTREAM.md` y evita conflictos |
| ¿Por qué no correr sus 34 migraciones? | Al menos 7 dependen de piezas de Supabase (`auth.`, `storage.`, `net.`, etc.). El spike probó el esquema declarativo, no las migraciones |
| ¿Cómo entra Atomic a nuestra base? | `0002_atomic_baseline.sql`: **copia congelada** de `backoffice/supabase/schemas/01…08`, generada por un script y con una marca del commit de origen. Solo se quita la línea de la extensión `http` |
| ¿Y un cambio futuro del upstream? | `db/upstream-migrations.lock` lista las migraciones de Atomic ya consideradas. Una prueba falla si aparece una nueva sin decidir. Se porta a mano a `db/migrations/` o se marca "no aplica" |
| ¿Y nuestras migraciones del 31/10? | Ya están reflejadas en los esquemas, así que entran con la línea base |
| ¿Dónde va lo nuevo? | Solo en `db/migrations/`. Nada nuevo en `backoffice/supabase/` |
| ¿Cómo se aplican? | Runner propio de ≈60 líneas con `pg`, con tabla `core.schema_migrations` y checksum. Nunca edita lo aplicado |

**Orden:**

| Archivo | Contenido |
|---|---|
| `db/bootstrap/00_roles.sql` | Roles. Corre una vez con superusuario |
| `0001_platform_compat.sql` | Esquemas `auth`, `storage`, `net`, `extensions`, con `citext`, `pgcrypto`, `unaccent`, `btree_gist` |
| `0002_atomic_baseline.sql` | Atomic |
| `0003_core_schema.sql` | `brands`, `channels`, identidades, conversaciones, mensajes, outbox |
| `0004_atomic_additions.sql` | Columnas nuevas en `contacts` y `deals` |
| `0005_pricing.sql` | Precios y cotizaciones |
| `0006_scheduling.sql` | Técnicos, disponibilidad, citas |
| `0007_api_functions.sql` | Funciones del esquema `api` |
| `0008_permissions.sql` | Revocaciones y permisos |

**La compatibilidad se conserva** (`auth.users`, `auth.uid()` y `net.http_post`, como en el spike). Es más barato y con menos conflictos que reescribir funciones de Atomic. Esto reemplaza el "desconectar `auth.users`" del ADR-001.

### 6.2 Tablas nuevas (esquema `core`)

Fuera de `db-schemas` de PostgREST: no se exponen. Todas llevan `created_at timestamptz not null default now()`.

**`core.brands`**

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK, identity |
| `slug` | `text` | `unique` |
| `name` | `text` | `not null` |
| `timezone` | `text` | `not null`. Orlando → `America/New_York` (**SUPUESTO**) |
| `default_sales_id` | `bigint` | FK `public.sales(id)`: dueño de tareas y oportunidades del bot |

**`core.channels`**

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `brand_id` | `bigint` | FK, `not null` |
| `provider` | `text` | `check in ('waha')`. Se amplía al sumar otros |
| `identifier` | `text` | Sesión WAHA, `not null` |
| `bot_key` | `text` | `not null`. Elige la URL del bot en la configuración |
| `secret_ref` | `text` | `not null`. **Nombre** de la variable con la clave HMAC, nunca el valor |
| `is_test` | `boolean` | `not null default false` |
| `active` | `boolean` | `not null default true` |
| | | `unique (provider, identifier)` |

**`core.unrouted_events`**: `id`, `provider`, `identifier`, `received_at`. Sin cuerpo ni teléfono. Canal desconocido: se registra, no llama a ningún bot.

**`core.contact_identities`**

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `brand_id` | `bigint` | FK, `not null` |
| `type` | `text` | `check in ('phone_e164','wa_lid')` |
| `value` | `text` | `not null`. `check` de formato E.164 cuando `type = 'phone_e164'` |
| `last_inbound_at` | `timestamptz` | |
| `last_verified_at` | `timestamptz` | |
| | | `unique (brand_id, type, value)` |

**`core.identity_holders`** (el titular es un período)

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `identity_id` | `bigint` | FK, `not null` |
| `contact_id` | `bigint` | FK `public.contacts(id) on delete restrict`, `not null` |
| `valid_from` | `timestamptz` | `not null default now()` |
| `valid_to` | `timestamptz` | `check (valid_to is null or valid_to > valid_from)` |
| `closed_reason` | `text` | `check in ('reassigned_confirmed','merged','manual')` |
| | | `exclude using gist (identity_id with =, tstzrange(valid_from, coalesce(valid_to,'infinity'::timestamptz),'[)') with &&)` |
| | | `unique (identity_id) where valid_to is null` |

**`core.conversations`**

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `brand_id`, `channel_id`, `identity_id` | `bigint` | FK, `not null` |
| `contact_id` | `bigint` | FK, `not null` |
| `opened_at`, `closed_at` | `timestamptz` | |
| `closed_reason` | `text` | |
| `superseded_by` | `bigint` | FK a sí misma. Ver token, sección 7.3 |
| `bot_paused` | `boolean` | `not null default false` |
| `bot_paused_at`, `bot_paused_reason` | | |
| `legacy_mem_key` | `text` | Para la importación futura |
| | | `unique (channel_id, identity_id) where closed_at is null` |

**`core.messages`**

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `brand_id`, `conversation_id`, `channel_id` | `bigint` | FK, `not null` |
| `direction` | `text` | `check in ('in','out')` |
| `sender` | `text` | `check in ('client','bot','human')` |
| `body` | `text` | Ya redactado |
| `provider_message_id` | `text` | |
| `sent_at` | `timestamptz` | `not null` |
| `bot_dispatched_at` | `timestamptz` | Permite reintentar tras una caída |
| `imported` | `boolean` | `not null default false` |
| | | `unique (channel_id, provider_message_id) where provider_message_id is not null`. **Es lo que descarta duplicados** |

**`core.outbox`**: `id`, `brand_id`, `channel_id`, `conversation_id`, `destination`, `body`, `status` (`check in ('pending','sending','sent','failed')`), `scheduled_at`, `attempts`, `sent_at`, `last_error`.

**`core.price_lists`** (precios versionados)

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `brand_id` | `bigint` | FK, `not null` |
| `version` | `integer` | `not null`, `unique (brand_id, version)` |
| `valid_from` | `timestamptz` | `not null` |
| `valid_to` | `timestamptz` | |
| `is_confirmed` | `boolean` | `not null default false`. **`false` = "por confirmar"** |
| `currency` | `text` | `not null` |
| `covered_rate`, `uncovered_rate` | `numeric(10,4)` | `not null`, `check (>= 0)` |
| `discount_pct` | `numeric(5,2)` | `check (between 0 and 100)` |
| `min_total` | `numeric(10,2)` | `not null` |
| `home_base_sqft`, `home_bedroom_sqft` | `numeric(10,2)` | `not null` |
| `parking_first_car_sqft`, `parking_extra_car_sqft` | `numeric(10,2)` | `not null` |
| `sqm_to_sqft`, `pace_to_ft` | `numeric(10,4)` | `not null` |
| `notes` | `text` | |
| | | `exclude using gist (brand_id with =, tstzrange(valid_from, coalesce(valid_to,'infinity'::timestamptz),'[)') with &&)` |

Un trigger impide cambiar los valores: un precio nuevo es una versión nueva. Solo se pueden tocar `valid_to` e `is_confirmed`.

**Datos de ejemplo** (`db/seeds/sample/`, `is_confirmed = false`), tomados de `[SM]`:136-218: 0,12 y 0,06 por pie², 7%, mínimo 150, base 1000, dormitorio 140, primer auto 240, auto adicional 200, 10,76 y 2,5.

**`core.quotes`** (inmutable, por trigger)

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `number` | `bigint` | `unique`, de una secuencia |
| `deal_id` | `bigint` | FK, `not null` |
| `version` | `integer` | `unique (deal_id, version)` |
| `price_list_id` | `bigint` | FK, `not null` |
| `covered_sqft`, `uncovered_sqft` | `numeric(12,2)` | `not null` |
| `subtotal`, `discount`, `total` | `numeric(12,2)` | `not null` |
| `min_applied` | `boolean` | `not null` |
| `inputs` | `jsonb` | Lo que dio el cliente |
| `status` | `text` | `check in ('sent','accepted','superseded')` |

**`core.scheduling_settings`** (una fila por marca)

| Columna | Ejemplo | Origen |
|---|---|---|
| `slot_minutes` | 60 | `[GRAB]`: 1 h. Por confirmar |
| `buffer_minutes` | 30 | **Inventado para pruebas.** Por confirmar |
| `hold_minutes` | 15 | Tu pedido |
| `min_notice_minutes` | 120 | **Inventado para pruebas.** Por confirmar |
| `horizon_days` | 14 | **Inventado para pruebas.** Por confirmar |
| `reverify_after_days` | 90 | `[ARQ]`:285. El Router usa 180. Decide JM |
| `is_confirmed` | `false` | |

**`core.technicians`**: `id`, `brand_id`, `name`, `phone_e164`, `sales_id` (opcional), `active`. En los datos de ejemplo es un técnico ficticio.

**`core.technician_availability`**: `id`, `technician_id`, `weekday` (`check between 0 and 6`), `start_time`, `end_time`, `check (end_time > start_time)`. Lista blanca: **lo que no está aquí no se ofrece**.

**`core.technician_time_off`**: `id`, `technician_id`, `period tstzrange`, `reason`.

**`core.appointments`** (la cita)

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `bigint` | PK |
| `brand_id` | `bigint` | FK, `not null` |
| `deal_id` | `bigint` | FK `public.deals(id) on delete restrict`, **`not null`** |
| `contact_id` | `bigint` | FK, `not null` |
| `technician_id` | `bigint` | FK, `not null` |
| `start_at`, `end_at` | `timestamptz` | `not null`, `check (end_at > start_at)` |
| `blocked_until` | `timestamptz` | `not null`, `check (blocked_until >= end_at)`. Fin + margen, guardado al reservar |
| `status` | `text` | `check in ('hold','confirmed','done','cancelled','no_show','expired')` |
| `hold_expires_at` | `timestamptz` | `check ((status = 'hold') = (hold_expires_at is not null))` |
| `address` | `text` | |
| `is_test` | `boolean` | `not null default false` |
| `confirmed_at` | `timestamptz` | |

**La regla anti-cruces:**

```sql
create extension if not exists btree_gist;

alter table core.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    technician_id with =,
    tstzrange(start_at, blocked_until, '[)') with &&
  )
  where (status not in ('cancelled', 'expired') and not is_test);

create unique index appointments_one_active_hold_per_contact
  on core.appointments (contact_id)
  where status = 'hold';
```

**Tres decisiones de diseño:**

1. **`blocked_until` es una columna, no un cálculo.** `timestamptz + interval` no es `immutable`, y Postgres no lo acepta en una exclusión. Cambiar el margen no reescribe citas ya tomadas.
2. **El margen va solo al final y aun así protege los dos lados.** Con 30 min, una cita 10:00–11:00 bloquea `[10:00, 11:30)`. Una de 09:00–10:00 bloquea `[09:00, 10:30)`, se cruza y **se rechaza**, que es lo correcto: entre las dos faltan 30 min.
3. **Un hold vencido no se puede excluir por fecha.** La condición de una exclusión tampoco admite `now()`. Por eso `reservar`, dentro de su transacción, primero pasa a `expired` los holds vencidos de ese técnico y de ese contacto. Además un barrido periódico los limpia. `horarios_libres` nunca los cuenta.

**Si un contacto reserva otra hora:** su hold anterior pasa a `cancelled` y toma el nuevo.

Todas estas restricciones están **escritas pero sin ejecutar**. Son lo primero que prueba CRM-T4.

### 6.3 Columnas nuevas en tablas de Atomic

Son aditivas y van en `0004_atomic_additions.sql`. `contacts_summary` nombra sus columnas una por una, así que no se rompe.

| Tabla | Columna | Detalle |
|---|---|---|
| `public.contacts` | `brand_id` | `bigint not null default 1`, FK `core.brands` |
| `public.contacts` | `is_test` | `boolean not null default false` |
| `public.contacts` | `preferred_language` | `text` |
| `public.deals` | `brand_id` | `bigint not null default 1`, FK |
| `public.deals` | `primary_contact_id` | `bigint`, FK `public.contacts` |
| `public.deals` | `is_test` | `boolean not null default false` |
| `public.deals` | `zip` | `text` |

- **`brand_id` con `default 1`:** para que el panel de Atomic siga creando registros sin cambios. Hay una sola marca viva.
- **`phone_jsonb`:** `core-api` lo llena con `{number, type}` al crear el contacto, para que pantallas y exportaciones sigan funcionando. La verdad está en `contact_identities`.
- **`service_visit_date` y `service_visit_time`** (de nuestro T0) se quedan en la Entrega 1 y el bot no los usa. Son una segunda fuente de verdad frente a `appointments`: se retiran en la Entrega 2.

### 6.4 Vista para el panel

```sql
create view public.appointments_summary as  -- security_invoker off, on purpose
select a.id, a.deal_id, d.name as deal_name, a.contact_id,
       c.first_name, c.last_name, a.technician_id, t.name as technician_name,
       a.start_at, a.end_at, a.status, a.hold_expires_at, a.address, a.is_test
from core.appointments a
join public.deals d on d.id = a.deal_id
join public.contacts c on c.id = a.contact_id
join core.technicians t on t.id = a.technician_id;
```

Va **sin** `security_invoker` a propósito: así `crm_api` lee la vista sin tener acceso al esquema `core`.

### 6.5 Avatar

`0004` reemplaza `public.get_avatar_for_email` por una versión que devuelve `null`. Se evitan el `"ERROR"` y que la base llame a un servicio externo con el hash del correo de un cliente. No se edita `backoffice/supabase/`.

### 6.6 Arreglo del grant de `deal_followup_events`

| Dónde | Cambio |
|---|---|
| `backoffice/supabase/schemas/06_grants.sql` | Agregar `grant select, insert on table public.deal_followup_events to authenticated;`, igual que la migración `20261031210000`. Es una línea nuestra, sin conflicto con upstream. Corrige el desajuste para quien use Supabase local |
| `db/migrations/0008_permissions.sql` | `grant select, insert on public.deal_followup_events to crm_api;` |
| `core-api/.../allowlist` | La tabla **no** pasa por el proxy: la usa solo el trigger |
| Prueba | Pasar una oportunidad a `won` desde el panel crea el evento y la tarea |

### 6.7 Roles y permisos

Sigue `[BASE]`:124-133 y agrega los roles de PostgREST del ADR-001.

| Rol | Login | Puede | No puede |
|---|---|---|---|
| `core_owner` | Sí, solo para migrar | Dueño de todo | Las apps nunca lo usan |
| `core_api` | Sí, `core-api` | `USAGE` en `api` y `EXECUTE` en `api.*` | **Leer o escribir tablas directamente** |
| `authenticator` | Sí, PostgREST | Cambiar a `crm_api` o `crm_anon` | Nada más (`NOINHERIT`) |
| `crm_api` | No | La lista de abajo | `core`, `api`, `auth.users`, `storage` |
| `crm_anon` | No | `USAGE` en `public`, nada más | Todo lo demás |
| `authenticated` | No | Nada propio. Existe porque las políticas de Atomic lo nombran, y `crm_api` es miembro | |
| `anon`, `service_role` | No | Nada. Existen para que cargue `06_grants.sql`; se les revoca todo | |

`core_backoffice` y `core_backup` de `[BASE]` se crean cuando haga falta: `crm_api` cubre el panel, y los respaldos son CRM-T12.

**`0008_permissions.sql`:**

```sql
-- 1. Default-deny
revoke all on all tables    in schema public from anon, authenticated, service_role, public;
revoke all on all sequences in schema public from anon, authenticated, service_role, public;
revoke all on all functions in schema public from anon, authenticated, service_role, public;
revoke all on schema public from public;
revoke all on all functions in schema api from public;
alter default privileges for role core_owner revoke execute on functions from public;

-- 2. core_api: functions only
grant usage on schema api to core_api;
grant execute on all functions in schema api to core_api;

-- 3. crm_api: the ADR-001 list, verified in the spike
grant usage on schema public to crm_api, crm_anon;
grant usage on schema auth, extensions to crm_api;
grant select, insert, update, delete on public.companies, public.contacts, public.contact_notes,
  public.deals, public.deal_notes, public.tags, public.tasks to crm_api;
grant select, update on public.configuration to crm_api;
grant select on public.sales to crm_api;
grant update (first_name, last_name, avatar) on public.sales to crm_api;
grant select, insert on public.deal_followup_events to crm_api;
grant select on public.activity_log, public.contacts_summary, public.companies_summary,
  public.appointments_summary to crm_api;
grant usage on all sequences in schema public to crm_api;
grant execute on function auth.uid(), public.is_admin(), public.global_search(text, text[], integer),
  public.search_document(variadic text[]), public.search_unaccent(text), public.search_query(text),
  public.search_attachment_titles(jsonb[]), public.get_avatar_for_email(text) to crm_api;
```

**Diferencias con el ADR-001:** se agrega `appointments_summary`, y sale `get_domain_favicon` porque el avatar ya no la llama.

**Funciones `api.*`:** todas `security definer`, `set search_path = ''`, dueño `core_owner`.

| Función | Tool o uso |
|---|---|
| `ingest_inbound(...)` | Webhook: dedupe, canal, identidad, titular, contacto, conversación, oportunidad y mensaje en **una transacción** |
| `bot_context(conversation_id)` | Historial y ficha |
| `contact_card(conversation_id)` | `ficha` |
| `save_contact_data(conversation_id, data)` | `guardar_datos` y detección de "Prueba" |
| `create_quote(conversation_id, inputs)` | `cotizar` |
| `free_slots(conversation_id, from_date, days)` | `horarios_libres` |
| `hold_slot(conversation_id, start_at)` | `reservar` |
| `confirm_hold(conversation_id)` | `confirmar`: sin id, confirma el hold de ese contacto; la oportunidad pasa a `won` |
| `escalate(conversation_id, reason)` | `escalar`: pausa y crea tarea `follow-up` para `default_sales_id` |
| `resolve_holder(conversation_id, is_same_person, new_name)` | `confirmar_titular` |
| `enqueue_reply(conversation_id, text)` | `responder` |
| `claim_outbox(limit)`, `finish_outbox(...)` | Worker de envío |
| `expire_holds()` | Barrido |
| `pending_dispatches()`, `mark_dispatched(...)` | Reintento de llamada al bot |

**Regla de precios y etapas en SQL:** `[BASE]` pide "precios y topes en SQL", y el bot no puede alterar el cálculo.

## 7. `core-api`

Node 24, Fastify 5, `pg` con parámetros, sin ORM. Node 24 ejecuta TypeScript sin compilar, así que no hace falta `tsx`.

### 7.1 Rutas (`core-api/ROUTES.md`; cualquier otra responde 404)

| Ruta | Quién | Protección |
|---|---|---|
| `POST /hooks/whatsapp` | WAHA | HMAC-SHA512 sobre el cuerpo crudo, en tiempo constante; timestamp de máximo 5 min |
| `GET /tools/ficha`, `POST /tools/*` | n8n | Bearer con token de conversación |
| `ALL /admin/rest/*` | Panel | En local: sesión de desarrollo. En VPS: Access. Lista cerrada de recursos y métodos |
| `GET /healthz` | Local | Sin datos |

### 7.2 Flujo de un mensaje

1. Leer el cuerpo crudo y verificar la firma con la clave de `channels.secret_ref`.
2. Validar con `zod`. Ignorar grupos, estados, canales y `fromMe`, como el Router.
3. Sacar el teléfono como el Router: `_data.Info.SenderAlt`, `_data.Info.Sender`, `participant`, `from`, sin `@lid`. Normalizar con `libphonenumber-js`. Solo `@lid`: identidad `wa_lid`.
4. Redactar tarjetas (Luhn).
5. `api.ingest_inbound(...)`. Si es duplicado: 200 y nada más.
6. **Responder 200 antes de llamar al bot** (`[ARQ]`:122).
7. Si `bot_paused`: guardar y no llamar.
8. Armar contexto, firmar el token y llamar al bot con `X-Core-Signature` y `X-Core-Timestamp`.
9. Si falla, un barrido reintenta usando `bot_dispatched_at`.

**Formato simulado.** Los campos salen del Router del workflow TEST: `session`, `payload.from`, `payload.body`, `payload.fromMe`, `payload.participant`, `payload._data.Info.{Sender,SenderAlt,PushName}`, `payload.notifyName`, `payload.media.url`. Las fixtures usan números ficticios.

**SUPUESTO que hay que confirmar con una captura real:** el Router **no usa** `payload.id`, y el dedupe lo necesita. Tampoco se ve ahí el formato real de la firma ni la unidad de `X-Webhook-Timestamp`. Tomo `[ARQ]`:196 y la forma pública de WAHA. El Router tampoco muestra `event`.

**No se traen del Router:** menú de marcas, códigos de acceso, puerta trasera, modo enseñanza. Son la plataforma de pruebas (auditoría, 6.5).

### 7.3 Contrato con el bot (se documenta en `docs/contratos/core-api-n8n.md`)

Conserva la forma aprobada de `[ARQ]`:127-141, con las claves en español para no cambiarla (decisión 8).

```text
POST <bot_url>
X-Core-Signature: <HMAC-SHA256 hex del cuerpo crudo>
X-Core-Timestamp: <segundos>
```

```json
{
  "token": "<JWT, 15 min>",
  "tenant": "salvionix",
  "bot": "javier",
  "canal": "whatsapp",
  "mensaje": { "id": "msg_123", "texto": "Hola, quiero cotizar" },
  "contacto": { "nombre": "Carlos", "nuevo": false, "reverificar": false, "telefono_enmascarado": "+1•••••0123" },
  "historial": [ { "de": "cliente", "texto": "..." }, { "de": "bot", "texto": "..." } ],
  "ficha": { "etapa": "contacted", "zip": null, "cotizacion_vigente": null, "cita": null }
}
```

- **Respuesta del bot:** `200` sin cuerpo. El texto vuelve por `POST /tools/responder`.
- **El teléfono completo no viaja a n8n** (`[ARQ]`:123). Va enmascarado. Si Javier necesita confirmarlo, decide Joel (auditoría, 6.5).

**Token:** JWT HS256 con `jose`. Claims: `iss`, `aud`, `brd`, `cnv`, `iat`, `exp`, `jti`. Clave propia, distinta de la de PostgREST.

**Desvío consciente de `[BASE]`:74:** no lleva `contacto_id`. El contacto siempre sale de la conversación. Motivo: cuando un número se reasigna, n8n ya tiene el token en el header y no puede cambiarlo a mitad de una ejecución. `core-api` sigue `superseded_by` y actúa sobre la conversación nueva. Así el token viejo no toca los datos del dueño anterior.

### 7.4 Tools

Todas: Bearer obligatorio, esquema `zod` **estricto** (un `contact_id` en el cuerpo da 400), `409 bot_paused` si la conversación está pausada, salvo `ficha`.

| Tool | Entrada | Efecto |
|---|---|---|
| `GET /tools/ficha` | Nada | Datos del contacto, oportunidad, cotización y cita. Teléfono enmascarado |
| `POST /tools/guardar_datos` | `nombre`, `apellido`, `email`, `idioma`, `tipo_cliente`, `tipo_espacio`, `direccion`, `tamano`, `zip` | Actualiza contacto y oportunidad. Si el nombre empieza con "Prueba": `is_test` en contacto, oportunidad y citas activas |
| `POST /tools/cotizar` | Hogar: `dormitorios`, `autos_techados`, `autos_descubiertos`. Empresa: `pies_cubiertos`. Ambos: `areas_extra[]` | Calcula en SQL, guarda cotización inmutable y pasa a `proposal-sent`. Devuelve `precios_confirmados: false` |
| `POST /tools/horarios_libres` | `desde`, `dias` | Solo horarios libres |
| `POST /tools/reservar` | `inicio` | Hold de 15 min. Si se cruza: `409 slot_taken` |
| `POST /tools/confirmar` | Nada | Confirma. Hold vencido: `409 hold_expired` |
| `POST /tools/escalar` | `motivo` | Pausa el bot y crea la tarea |
| `POST /tools/confirmar_titular` | `es_la_misma_persona`, `nombre_nuevo` | Sección 7.5 |
| `POST /tools/responder` | `texto` | Lo encola en `outbox` |

**`confirmar_titular` y `responder` no estaban en tu lista.** Hacen falta: sin la primera no hay forma de "confirmar que es otra persona"; sin la segunda el bot no puede contestar (`[ARQ]`:149). Decisión 8.

**Cálculo:** cubierto × tarifa + descubierto × tarifa = subtotal; se resta el descuento; se redondea al dólar; si da menos del mínimo, se aplica el mínimo (`[SM]`:213-218).

### 7.5 Número reasignado

1. Tras `reverify_after_days` sin hablar, el contexto trae `reverificar: true`.
2. **Es la misma persona:** se actualiza `last_verified_at` y sigue.
3. **Es otra persona**, en una transacción:
   - se cierra el titular (`valid_to`, `reassigned_confirmed`);
   - se crea un contacto y una oportunidad nuevos, y un titular abierto;
   - se cierra la conversación con `superseded_by` y se abre otra.
4. **Nada se borra:** mensajes, citas y cotizaciones siguen en el contacto anterior, y el bot no los ve.

**Falta una decisión de JM:** el plazo (90 días en `[ARQ]`, 180 en el Router). Es configuración.

### 7.6 Panel

| Punto | Decisión |
|---|---|
| Carpeta | `backoffice/src/components/atomic-crm/providers/core-api/` (el spike era `providers/postgrest/`) |
| `CRM.tsx` | **Sin tocar.** Vuelve al estado de T0, sin atajo |
| Selección | `VITE_DATA_PROVIDER=core-api` en `backoffice/src/App.tsx`, que pasa `dataProvider` y `authProvider` como props. Sin la variable, sigue Supabase. El proyecto ya prevé esas props, y así hay poco conflicto |
| Token | Sale del frontend: nada de `VITE_SPIKE_TOKEN`. El navegador llama a `/admin/rest/*`; `core-api` firma el JWT de PostgREST |
| Autenticación local | `core-api` escucha en `127.0.0.1` con un usuario de desarrollo por configuración. No arranca así fuera de `NODE_ENV=development` |
| Lista cerrada | Solo los recursos y métodos de la sección 6.7. `rpc` solo `global_search`. La raíz (OpenAPI) y `deal_followup_events` se niegan |
| Citas | Recurso de solo lectura sobre `appointments_summary`, con filtros de estado y técnico |
| Lo que no funciona sin Supabase | Registro, gestión de usuarios, contraseñas, combinar contactos, adjuntos y logos: error claro, igual que en el spike. Se atienden en la Entrega 2 |

**Las oportunidades y contactos "Prueba" se ven en el panel** en esta entrega, con su nombre. Filtrarlos de reportes y del panel principal es Entrega 2.

**Propuesta, no incluida en las horas:** mostrar la conversación en la ficha del contacto (+1 h). "La memoria en el CRM" se vería mucho mejor en la demo. Dime si la sumo.

## 8. Dependencias nuevas

**Consultadas hoy en npm.** Se pidió el árbol en una carpeta temporal fuera del repo, solo con `--package-lock-only`, sin instalar nada y con el `.npmrc` del repo. Solo van en `core-api/`. `backoffice/` no cambia.

`min-release-age=1` significa al menos 1 día.

### 8.1 Producción

| Paquete | Versión | Licencia | Publicada | ¿Cumple? | Para qué |
|---|---|---|---|---|---|
| `fastify` | **5.12.7** | MIT | 13/10/2026 | Sí | Servidor. **La 5.12.8 es de hoy y no cumple** |
| `pg` | 8.23.1 | MIT | 30/09/2026 | Sí | Postgres |
| `zod` | 4.6.7 | MIT | 12/10/2026 | Sí | Esquemas. Misma versión que `backoffice` |
| `libphonenumber-js` | 1.13.15 | MIT | 08/10/2026 | Sí | E.164 |
| `jose` | **6.2.13** | MIT | 20/10/2026 | Sí | JWT. **La 6.2.15 tiene menos de 1 día.** Misma versión que `backoffice` |

### 8.2 Desarrollo

| Paquete | Versión | Licencia | ¿Cumple? |
|---|---|---|---|
| `typescript` | 5.8.3 | Apache-2.0 | Sí. Igual que `backoffice` |
| `vitest` | **5.0.5** | MIT | Sí. **La 5.1.0 es de hoy.** Igual que `backoffice` |
| `@types/pg` | 8.23.1 | MIT | Sí, 17/08/2026 |
| `@types/node` | 24.19.2 | MIT | Sí, 09/10/2026 |

### 8.3 Árbol completo de producción

- **64 paquetes:** 56 MIT, 4 BSD-3-Clause, 4 ISC. Ninguna licencia restrictiva. Todas permiten vender el producto.
- **El más nuevo:** `fast-json-stringify` 7.2.1, con 1,1 días: cumple justo. Si al instalar hubiera cambios, `npm ci --ignore-scripts` usa el lockfile fijado.
- `npm audit` sobre ese árbol: 0 vulnerabilidades.

### 8.4 Lo que evité

| Dependencia | Por qué no |
|---|---|
| `tsx` | Node 24 ejecuta TypeScript |
| `fastify-raw-body` | Fastify lee el cuerpo crudo con su `addContentTypeParser` |
| `@fastify/reply-from` | El proxy se hace con `fetch` |
| `@fastify/rate-limit` | Solo aplica con rutas públicas; en la Entrega 1 todo es local |
| `testcontainers` | La CI usa `services` de GitHub, y en local está el Compose |

### 8.5 Imágenes de Docker (no son npm)

`postgres:17.10` y `postgrest/postgrest:v16.4`, las del spike, solo en `127.0.0.1`.

## 9. Criterios de aceptación

Pruebas automáticas en `core-api/test/` con Vitest y **Postgres real**, sin simular la base. Cada una falla si se quita la regla que protege.

### 9.1 Los que pediste

| # | Prueba | Se comprueba |
|---|---|---|
| A1 | **Cruce rechazado** | Dos citas reales del mismo técnico que se cruzan: la segunda da `23P01` en la base y `409 slot_taken` en la tool. También **insertando directo por SQL**, sin pasar por `core-api` |
| A2 | Cruce por el margen | Con margen 30: 10:00–11:00 y 11:15–12:15 se rechaza; 11:30–12:30 se acepta |
| A3 | **Sin contar cancelados ni pruebas** | Un slot `cancelled`, `expired` o `is_test` no bloquea. Otro técnico a la misma hora tampoco |
| A4 | Carrera | Dos `reservar` en paralelo por el mismo horario: exactamente una gana |
| A5 | **Hold vencido** | Vencido, `confirmar` da `409 hold_expired`, `horarios_libres` lo ofrece de nuevo, y otro contacto puede reservarlo |
| A6 | Un hold por contacto | Un segundo `reservar` libera el primero y deja uno solo |
| A7 | **Reasignado: otra persona** | Se cierra el titular, hay contacto y oportunidad nuevos; el historial sigue en el anterior y **el contexto nuevo no lo incluye** |
| A8 | Reasignado: misma persona | Sigue con su contacto y su historial |
| A9 | Reasignado: período | Dos titulares abiertos para una identidad son rechazados por la base |
| A10 | Token tras reasignar | El token viejo actúa sobre la conversación nueva, sin leer datos del dueño anterior |
| A11 | **Prueba X** | "Prueba Sebas" marca contacto y oportunidad; también "prueba sebas" |
| A12 | Prueba no bloquea | La cita de "Prueba" no impide a un cliente real reservar esa hora |
| A13 | Prueba tardía | Hold tomado antes de dar el nombre: al decir "Prueba X" deja de bloquear |
| A14 | Límites de la regla | "Pruebas Ltda" marca, porque empieza con "Prueba". "Juan Prueba" no marca. Comportamiento documentado |
| A15 | **Firma inválida** | Firma mala, ausente o sobre otro cuerpo: 401, sin fila nueva y sin llamada al bot |
| A16 | Timestamp viejo | Más de 5 min: 401 |
| A17 | **Duplicado** | Mismo `payload.id` dos veces: un mensaje y una llamada al bot, ambos 200 |
| A18 | **Token vencido** | `exp` pasado: 401 en todas las tools. También token mal firmado y con `aud` equivocado |

### 9.2 Los que hacen falta para confiar en la demo

| # | Prueba | Se comprueba |
|---|---|---|
| B1 | E.164 | Casos del Router: `@c.us`, `@s.whatsapp.net`, con `:` de dispositivo, `@lid`, `SenderAlt`, sin `+` |
| B2 | Canal desconocido | Queda en `unrouted_events`, sin llamar al bot |
| B3 | Ajenos | Grupos, estados, `fromMe`: se ignoran |
| B4 | Sin id de cliente | Una tool con `contact_id` en el cuerpo: 400 |
| B5 | Aislamiento | Con el token de A no se ven datos de B |
| B6 | Cotización exacta | Ver vectores abajo |
| B7 | Precios en tabla | Versión nueva, nuevo cálculo; cotización anterior intacta. **Búsqueda en el código de `core-api` sin tarifas fijas** |
| B8 | Precios inmutables | `update` a una tarifa o a una cotización: rechazado |
| B9 | Lista blanca | Sin disponibilidad no se ofrece nada; `time_off` y anticipación respetados |
| B10 | Zona horaria | Horarios en la zona de la marca, incluido un cambio de horario |
| B11 | Escalar | Pausa, crea tarea; el siguiente mensaje se guarda pero **no llama al bot** |
| B12 | Tarjetas | Un número que pasa Luhn no queda en `messages` ni llega al bot |
| B13 | Permisos `core_api` | `select` directo a una tabla: denegado |
| B14 | Permisos PostgREST | Sin token 401; `role=postgres` 403; `core`, `api` y `auth.users` inaccesibles |
| B15 | Proxy | Recurso fuera de la lista, `rpc` ajena y OpenAPI: 404 |
| B16 | Ganar | `confirmar` deja la oportunidad en `won` y crea la tarea de seguimiento (arreglo del grant) |
| B17 | Migraciones nuevas del upstream | Una migración de Atomic no listada en el lock: prueba en rojo |
| B18 | Base desde cero | Bootstrap y migraciones cargan sobre una base vacía. Correr el runner otra vez no cambia nada |

**Vectores de cotización** (`[SM]`:213-218, valores de ejemplo):

| Caso | Pies cubiertos | Pies descubiertos | Subtotal | −7% | Total | Mínimo |
|---|---:|---:|---:|---:|---:|---|
| Hogar: 3 dormitorios, 2 autos techados | 1860 | 0 | 223,20 | 207,576 | **208** | No |
| El anterior + 1000 descubiertos | 1860 | 1000 | 283,20 | 263,376 | **263** | No |
| Empresa: 1000 cubiertos | 1000 | 0 | 120,00 | 111,60 | **150** | Sí |
| 3 autos descubiertos | 1000 | 640 | 158,40 | 147,312 | **150** | Sí |

### 9.3 Panel

No hay Chromium instalado en `C:\CRM`. Si lo apruebas (decisión 4), corren los tests `app`. La verificación de la demo se hace en el navegador integrado con el guion: contactos, oportunidades, y citas de solo lectura sin botones de escritura.

### 9.4 Guion de demo (`core-api/dev/demo.ts`)

Con la pila arriba, ejecuta estos escenarios y deja los datos para mirarlos en el panel: cliente nuevo → datos → cotización → horarios → reserva → confirmación; cruce rechazado; hold vencido; firma inválida; duplicado; reasignado; Prueba X; escalar.

## 10. Simulado frente a real

| Pieza | En la Entrega 1 | Para pasarla a real | Quién | Horas |
|---|---|---|---|---:|
| **WAHA** entrante | `dev/waha-sim.ts` firma y envía | Sesión de pruebas de BYTOGAM, webhook **por sesión** apuntando a `core-api`, HMAC con clave real. **Primero una captura real** para confirmar `payload.id`, firma y timestamp | Joel, Sebastián | 1–2 |
| **WAHA** saliente | El simulador recibe `/api/sendText` | Cambiar `WAHA_BASE_URL` y `X-Api-Key`; ajustar el ritmo con Joel | Joel | 0,5 |
| **Bot** | `dev/mock-bot.ts`: reglas fijas, **sin Claude** | Clonar Javier sin memoria ni Router, tools HTTP con `Authorization` desde el webhook (nunca del LLM), verificar firma, reescribir el cierre: ofrece, no acepta (`[SM]`:322) | Sebastián, OK de Joel | 6 (CRM-T7) |
| **Notas de voz** | Se guarda un marcador | Hoy las transcribe n8n. Pasar el audio transcrito a `core-api` | Sebastián | 1 |
| **VPS** | Compose local | Postgres propio, redes separadas, secretos en archivos 600, `core-api` y PostgREST sin puertos publicados | Joel, Sebastián | 4 (CRM-T2) |
| **Login** | Usuario de desarrollo | **POR DECIDIR con Joel:** subdominios y Cloudflare Access | Joel | 5 (CRM-T3) |
| **Permisos** | ADR-001 + `core_api` | OK de Joel: `[BASE]`:130 dice "solo `EXECUTE`", y `crm_api` lee vistas y tablas | Joel | — |
| **Precios y agenda** | Datos de ejemplo, "por confirmar" | JM confirma; se carga una versión nueva con `is_confirmed = true` | JM | 0,5 |
| **Técnico** | Ficticio | Esteban y disponibilidad real | JM | 0,5 |
| **Sesiones** | Nombres de ejemplo | Inventario de WAHA (`[ARQ]`:184): cargar `channels` | Joel | 0,5 |
| **Alertas** | Log local | Discord, sin datos de clientes | Joel | 0,5 |
| **Pruebas reales** | — | 13 casos en el número de BYTOGAM, primero | Todos | CRM-T11 |

**Lo que JM debe saber antes de la demo:** el bot de la demo sigue un guion, no es Javier con Claude. Lo real (agenda, memoria, reglas) es la base y `core-api`. Si JM espera conversar libremente con Javier, hace falta CRM-T7 con n8n, que está fuera de "sin VPS y sin WAHA".

## 11. Decisiones que necesito

| # | Decisión | Mi recomendación |
|---:|---|---|
| 1 | Aprobar este plan y CRM-T0b | Sí |
| 2 | **Dependencias de la sección 8**, juntas y una sola vez | Sí |
| 3 | **Docker local para el desarrollo y las pruebas.** Tu regla lo permite solo para el spike | Sí, con las mismas condiciones: imágenes fijas y solo `127.0.0.1` |
| 4 | **Dos herramientas que no son npm:** gitleaks 8.30.1 desde los releases oficiales, con checksum (el hook lo exige), y Chromium de Playwright para los tests `app` que pide el CI | Sí a ambas |
| 5 | **Carpeta de trabajo.** Cambiar `C:\CRM` a la estructura de monorepo rompería tu arranque de Supabase. Propongo un worktree en `C:\salvionix-platform`, lo que amplía tu regla de "solo `C:\CRM`" | Sí |
| 6 | Borrar `origin/crm-t0-rescate` al publicar CRM-T0b (sección 2.3) | Sí, con tu orden en ese momento |
| 7 | Usar el commit `9a5cb4b9` en vez de una release | Sí |
| 8 | Sumar `confirmar_titular` y `responder`, y las claves en español en el contrato HTTP (código y base siguen en inglés) | Sí |

**Preguntas abiertas para JM, sin bloquear la demo:** plazo de reasignados (90 o 180 días), margen entre servicios, si puede vender fuera de la zona del técnico. **Para Joel:** captura real de WAHA, OK de permisos y teléfono enmascarado.

## 12. Fuera de la Entrega 1

n8n real, VPS, Cloudflare, sesión real de WAHA, SMS, notas de voz, formulario, descuento por zona y cobertura de ZIP, PDFs, importar historial, pausa/reanudar desde el panel, edición de citas, gestión de usuarios, adjuntos, STOP y consentimientos, uso de LLM y auditoría.

**Antes de campañas reales,** STOP y consentimientos son obligatorios (`[BASE]`:67).
