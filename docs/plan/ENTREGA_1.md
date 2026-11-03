# Plan de la Entrega 1 (demo funcional en local)

- **Fecha:** lunes 02/11/2026
- **Estado:** APROBADO el 02/11/2026 con los ajustes de la sección 13. CRM-T0b, T4, T5, T6, T9, T10 y T8a están hechos en ramas `wip/` encadenadas, sin publicar. Falta CRM-T7a (n8n local), CRM-T11 (simulador y guion de la demo) y publicar.
- **Alcance:** todo en local, sin VPS, sin WAHA real y sin Joel. Decisión tomada: opción C ([ADR-001](../decisiones/ADR-001-proveedor-datos.md)) y destino en el monorepo de `origin/f1-b0-repo-base`.
- **Convención:** nombres de tablas, columnas, código y commits en inglés. Este documento y `docs/` en español.
- **Citas:** `[ARQ]`, `[BASE]`, `[SM]` y `[GRAB]` son las claves definidas al inicio de la auditoría. Lo no verificado se marca **SUPUESTO**.

## 1. Resumen

1. **El monorepo es un esqueleto.** `core-api/`, `db/`, `infra/` y `n8n/` solo tienen un README. Lo real es `backoffice/` (Atomic v1.6.0 del 22/09), el CI y el hook de gitleaks.
2. **Los `.env` de `backoffice/` son las plantillas del upstream:** idénticos byte a byte (sección 2.2).
3. **Estimación: 47 h base, ≈56 h con 20% de margen** (con el Javier real de la demo y las pruebas de "sin equivocarse"). Son más que las 28,5 h de la auditoría (sección 5). A 30 h por semana, no caben en la semana del 08/11. La sección 5.2 dice qué recortar y cuándo decidirlo.
4. **Hay un problema causado por mi push anterior:** `origin/crm-t0-rescate` contiene toda la historia del upstream, y el CI escanea todas las ramas con gitleaks (sección 2.3).
5. **Las 8 decisiones de la sección 11 están aprobadas**, con los ajustes de la sección 13.

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
- **Verificado el 02/11 con gitleaks 8.30.1 local** (mismas opciones que el CI): escanear las ramas de `origin` da **13 hallazgos**, todos en la historia que trae `crm-t0-rescate`. `wip/monorepo` (15 commits) da 0. Cuando `ci.yml` llegue a esa rama, el job `secrets` se pondría en rojo. Mi push no lo disparó, porque esa rama trae los workflows del upstream y no este `ci.yml`.
- **No son secretos nuevos.** Es ruido de fixtures públicas, pero rompería el CI.
- **Decisión de Sebastián:** al publicar CRM-T0b se borra `origin/crm-t0-rescate` en el mismo paso. El trabajo queda en el monorepo y en la rama local.

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

### 3.5 Resultado de CRM-T0b (02/11/2026, `wip/monorepo`, sin publicar)

| Paso | Resultado |
|---|---|
| Worktree | `C:\salvionix-platform`, rama `wip/monorepo` desde `origin/f1-b0-repo-base`. `core.hooksPath` solo para ese worktree (`C:\CRM` no cambia) |
| gitleaks | 8.30.1 oficial con checksum verificado, en `.tools/gitleaks/` (ignorado por git). El hook de commits corre y pasa |
| Subtree | `git subtree pull --prefix=backoffice . refs/remotes/upstream/main --squash`. Con `<url> <sha>` falla ("couldn't find remote ref"). Squash `5468b58d`. `.devcontainer/` **no** reapareció |
| Conflicto | Solo `getContactAvatar.test.ts`, como se esperaba. Se tomó la versión del upstream y **pasa**: el arreglo propio ya no hace falta |
| Commits propios | Los 7 se reaplicaron con `git am -3 --directory=backoffice`, **sin conflictos**. `backoffice/src` y `backoffice/supabase` quedaron **idénticos** a `crm-t0-rescate` (comparación de árboles) |
| Documentos | Auditoría, ADR-001 (con la causa del avatar corregida como "probable, no verificada") y este plan en `docs/`. `FLUJO` y `GUIA` pasaron a `docs/`. `CLAUDE.md` raíz nuevo; el de `backoffice/` quedó como el del upstream |
| Convenciones | `UPSTREAM.md`, `NOTICE`, `README`, `DESARROLLO.md` y plantilla de PR actualizados a `CRM-Tn` y `wip/` |
| Validación (como el CI) | `npm ci --ignore-scripts` ok; `typecheck` ok; `lint` ok; tests `functions` 192 de 192; tests `app` **296 pasaron y 1 omitido en 42 archivos**; `build:demo` ok |
| gitleaks sobre `wip/monorepo` | 15 commits, 0 hallazgos |

**Los tests `app` fallaron al principio, 5 en 3 archivos**, por nuestro trabajo de T0 y no por el upstream: esos tests afirmaban las etiquetas de fábrica ("Call", "Proposal Sent", "Copywriting") y T0 cambió etapas, categorías y tipos de tarea. Se actualizaron los datos de prueba en `DataImportButton.test.tsx`, `TaskCreateSheet.test.tsx` y `searchDealCategories.test.ts`. No se tocó código de producción.

**Pendiente de T0b:** CI en GitHub (no hay `gh`; lo verá Joel o tú al publicar), y la orden "publica CRM-T0b".

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
| 2 | **CRM-T4** | Compose local, roles, capa de compatibilidad, línea base de Atomic, tablas `core`, precios, agenda, documentos, runner de migraciones, pruebas de esquema | 10 |
| 3 | **CRM-T5** | Fastify, webhook, firma, duplicados, E.164, redacción de tarjetas, resolución de marca a titular, contexto, token, llamada al bot, outbox, proxy `/admin/rest` | 8 |
| 4 | **CRM-T6** | Las 9 tools (decisión 8) con esquema estricto, y la revisión de `responder` (sección 9.2) | 8 |
| 5 | **CRM-T9 (local)** | Disponibilidad, horarios libres, hold con vencimiento, manejo del cruce, vista de citas | 4 |
| 6 | **CRM-T10** | Número reasignado, "Prueba X", casos de teléfono | 2 |
| 7 | **CRM-T8 (panel)** | Carpeta definitiva, selección por configuración, autenticación local, lista de citas de solo lectura | 3 |
| 8 | **CRM-T7 (parte local)** | n8n en Docker, copia del workflow TEST sin memoria que llama a `core-api`, y prueba adversaria con Claude (sección 7.7) | 6 |
| 9 | **CRM-T11 (parte)** | Simulador, mock del bot (para las pruebas automáticas), contrato HTTP, guion de demo, job de CI | 3 |
| | **Total base** | | **47** |
| | **Con 20% de margen** | | **≈56** |

CRM-T1 ya se hizo. Las pruebas van dentro de cada tarea, no al final. Dependencias: T0b → T4 → T5 → T6 → (T9, T10) → T8 → T7 (local) → T11. El mock del bot se queda para las pruebas automáticas: son deterministas, y Claude no lo es.

### 5.1 Por qué sube frente a las 28,5 h de la auditoría

| Cambio | Horas |
|---|---:|
| CRM-T0b no existía | +3 |
| Panel y proxy, antes en la Entrega 2 | +4 |
| Precios versionados y tools adicionales | +2 |
| Más pruebas de aceptación y simulador | +3 |
| Salen n8n real, VPS y sesión de WAHA (pasan a después) | ≈ −4 |
| Línea base más fina de T4, T5, T6, T9 y T10 | ≈ +2,5 |
| Javier real en local (CRM-T7, parte local), ajuste 2 | +6 |
| Documentos en el esquema (+1) y revisión de `responder` (+1) | +2 |

Estos desgloses son mi estimación, no una medición.

### 5.2 ¿Cabe en el plazo?

- **Con las horas base, no.** A 30 h por semana y 5 h por día (domingo libre), 47 h dan ≈9,5 días de trabajo: **≈13/11**, no el 08/11.
- **CRM-T0 y T1 tomaron bastante menos reloj que lo estimado** (ya tienes esas cifras en el chat). Puede repetirse, pero no lo doy por hecho: T4 a T6 tienen más diseño y más revisión tuya.
- **Punto de control:** al terminar CRM-T4 y T5 comparo horas reales con estimadas y te digo la fecha nueva.

**Qué recortar si vamos tarde, en este orden:**

| Recorte | Ahorra | Costo |
|---|---:|---|
| Panel directo a PostgREST en local, sin proxy (el proxy pasa a la Entrega 2) | 1 h | La demo no muestra la "única puerta". **Producción sigue exigiéndolo** |
| Citas por SQL en la demo, sin lista en el panel | 1 h | Incumple el punto 8. Solo con tu OK |
| Outbox sin ritmo ni reintentos | 0,5 h | Se agrega antes de usar WAHA real |
| Javier real (CRM-T7 local): la demo usa solo el mock del bot | 6 h | La demo sigue un guion, no es Javier con Claude. Es el recorte más grande: solo con tu OK |

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
| `0007_documents.sql` | Cotización, orden de compra y orden de trabajo: numeración e inmutabilidad |
| `0008_api_functions.sql` | Primeras funciones del esquema `api`; las de negocio llegan en migraciones de CRM-T5, T6, T9 y T10 |
| `0009_permissions.sql` | Revocaciones y permisos |

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

### 6.6 El grant de `deal_followup_events` (corrección)

**Mi hallazgo del ADR-001 estaba mal: no hay desajuste.** `backoffice/supabase/schemas/06_grants.sql` sí da `select, insert` a `authenticated`, igual que la migración `20261031210000` (línea 100). Mi búsqueda de entonces no incluía la palabra `authenticated`, y no lo vi. El ADR quedó corregido y **no hace falta tocar `backoffice/`**.

Lo que falló en el spike fue otra cosa: `90_roles.sql` le revocó todo a `authenticated` y faltaba darle el permiso a `crm_api`.

| Dónde | Qué queda |
|---|---|
| `db/migrations/0009_permissions.sql` | `grant select, insert on public.deal_followup_events to crm_api;` |
| Proxy de `core-api` | La tabla **no** pasa: la usa solo el trigger |
| Prueba | Ganar una oportunidad desde PostgREST crea el evento y la tarea (pasa) |

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

**`0009_permissions.sql`:**

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

**Formato tomado de la documentación oficial de WAHA** ([eventos](https://waha.devlike.pro/docs/how-to/events/), consultada el 02/11/2026). Es un **SUPUESTO hasta tener una captura real**:

| Dato | Lo que dice la documentación | Cómo lo usan el simulador y `core-api` |
|---|---|---|
| Cuerpo | `{"event":"message","session":"default","engine":"WEBJS","payload":{...}}` | El simulador envía ese sobre, con `session` = el canal |
| `payload.id` | Ejemplo `true_11111111111@c.us_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`. La página no lo define; otra sección da `{fromMe}_{chatId}_{messageId}[_{participant}]` | El simulador genera `false_<chatId>_<32 hex>`. **Clave de dedupe:** `payload.id` completo, junto con el canal |
| `payload.timestamp` | Segundos (ejemplo `1667561485`; no lo dice expresamente) | El simulador manda segundos |
| `X-Webhook-Hmac` | Firma del **cuerpo crudo**, `sha512`. La codificación no está explícita (el ejemplo es hexadecimal) | HMAC-SHA512 en hexadecimal, en tiempo constante |
| `X-Webhook-Hmac-Algorithm` | `sha512` | Se exige que valga `sha512` |
| `X-Webhook-Timestamp` | **Milisegundos** desde Unix. No se dice si entra en la firma | Se rechaza si pasan más de 5 min. **La firma no lo cubre:** la protección contra repetición es el dedupe por `payload.id` |
| `X-Webhook-Request-Id` | Id único por petición | Solo para el registro. No es clave de dedupe: no sé si un reintento lo repite |

Falta confirmar con una captura real: el formato exacto de `payload.id` en tu motor (`NOWEB` o `WEBJS`), la codificación de la firma y la unidad de `payload.timestamp`. El Router de TEST no usa `payload.id` ni `event`, así que no sirve de prueba.

**No se traen del Router:** menú de marcas, códigos de acceso, puerta trasera, modo enseñanza. Son la plataforma de pruebas (auditoría, 6.5).

### 7.3 Contrato con el bot (se documenta en `docs/contratos/core-api-n8n.md`)

Conserva la forma aprobada de `[ARQ]`:127-141, con las claves en español para no cambiarla (decisión 8).

```text
POST <bot_url>
X-Core-Signature: <HMAC-SHA256 hex de "<timestamp>.<cuerpo crudo>">
X-Core-Timestamp: <segundos>
```

**Contrato implementado y documentado completo en `docs/contratos/core-api-n8n.md`.** Dos diferencias con lo que dice esta sección, ambas más seguras: la firma incluye el timestamp (un mensaje capturado no se reenvía más tarde), y `mensaje.id` es un id propio (`msg_<n>`), no el de WAHA.

```json
{
  "token": "<JWT, 15 min>",
  "tenant": "salvionix",
  "bot": "javier",
  "canal": "whatsapp",
  "mensaje": { "id": "msg_1234", "texto": "Hola, quiero cotizar" },
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

### 7.7 Javier real en la demo (parte local de CRM-T7, ajuste 2)

**Alcance:** n8n en Docker local con una copia del workflow TEST, sin memoria propia, que llama a `core-api` local con el contrato de la sección 7.3. Mensajes simulados. Sin VPS ni WAHA real. **El mock del bot se conserva solo para las pruebas automáticas.**

| Pieza | Decisión |
|---|---|
| Imagen | `n8nio/n8n:2.43.5`, la que corre en producción (bitácora del 01/11, confirmado por Sebastián). Publicada el 14/10/2026 |
| Red | Solo `127.0.0.1:5678`. Volumen propio. `N8N_ENCRYPTION_KEY` generada en local y **fuera del repo**. Telemetría y diagnóstico apagados |
| Licencia | Sustainable Use: uso interno y de desarrollo. **No se empaqueta** dentro del producto (auditoría, sección 2) |
| Workflow | `n8n/workflows/javier-core-api-local.json`, **exportado sin credenciales, sin datos fijados y sin números** |
| Qué se conserva de TEST | El nodo AI Agent con su mensaje de sistema, y el modelo `claude-sonnet-5-5` que ya usa TEST |
| Qué sale | Router, menú de marcas y códigos, puerta trasera, modo enseñanza, nodos de WAHA, notas de voz, nodo de memoria de Postgres, y los **datos fijados** (`pinData`), que pueden traer conversaciones reales |
| Qué entra | Webhook de entrada con verificación de `X-Core-Signature` y `X-Core-Timestamp`; armado del mensaje con el historial del cuerpo; **9 nodos HTTP Request Tool** hacia `/tools/*`, con `Authorization: Bearer` tomado del webhook y **nunca del modelo** |
| Prompt | Se reescriben 3 zonas del mensaje de sistema de TEST: (1) el cálculo y **todos los precios y ejemplos con montos** (`[SM]`:136-231) salen y pasan a llamar a `cotizar`; (2) "acepta cualquier hora" pasa a "ofrece solo `horarios_libres` y reserva con `reservar`" (`[SM]`:322); (3) se agregan `escalar` y `confirmar_titular`. **El texto comercial y las afirmaciones del producto no se tocan** sin OK de JM |
| Respuesta | El agente termina llamando a `responder`; el flujo no escribe a WAHA |

**Horas: 6 (base).**

| Tarea | Horas |
|---|---:|
| Compose de n8n, volumen, clave de cifrado y arranque | 0,5 |
| Copia saneada del workflow, nodos de entrada y 9 herramientas | 2,5 |
| Reescritura de las 3 zonas del prompt | 1 |
| Pruebas de punta a punta con Claude y ajustes | 1 |
| Prueba adversaria (9.2, C1.5 y C2.5) | 0,5 |
| Runbook y exportación sin credenciales | 0,5 |

**Qué necesito para la credencial de Anthropic.** No la busco en ningún archivo ni la leo:

1. **Tú consigues una llave nueva solo para esta demo**, con un nombre como `salvionix-local-dev` y un **límite de gasto mensual bajo** (propongo 10 USD) en el panel de Anthropic. Si se filtra o el flujo entra en bucle, el daño tiene tope. No reutilices la de producción.
2. **Tú la escribes en n8n.** Cuando el contenedor esté arriba, abres `http://127.0.0.1:5678`, creas el usuario propietario y, en *Credentials → Create → Anthropic*, pegas la llave. Yo te digo el nombre exacto de la credencial, que es lo único que usa el flujo.
3. n8n la cifra con `N8N_ENCRYPTION_KEY` dentro de su volumen, que `.gitignore` y gitleaks no dejan subir. La llave nunca pasa por un archivo del repo ni por el chat.
4. Modelo de la demo: `claude-sonnet-5-5`, el mismo de TEST (confirmado).
5. **Costo de la demo, SUPUESTO (no medido):** el mensaje de sistema pesa unos 23.000 caracteres y cada vuelta con herramientas lo repite. Estimo 8 a 15 llamadas por recorrido completo, unos 0,2 a 0,5 USD. Lo mido en la primera corrida y te lo digo.

**Riesgos:** (a) Claude no es determinista: la demo puede variar, y por eso las pruebas automáticas usan el mock. (b) Si Claude llama a una herramienta con un campo de más, `core-api` responde 400 y el modelo reintenta: hay que ver cuánto gasta. (c) Hoy el Router decide el idioma del saludo según el país del celular; sin Router, el idioma del cliente viaja en `contacto.idioma`.

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

`postgres:17.10` y `postgrest/postgrest:v16.4`, las del spike, y `n8nio/n8n:2.43.5` (7.7), todas solo en `127.0.0.1`.

## 9. Criterios de aceptación

Pruebas automáticas en `core-api/test/` con Vitest y **Postgres real**, sin simular la base. Cada una falla si se quita la regla que protege.

### 9.1 Los que pediste

| # | Prueba | Se comprueba |
|---|---|---|
| A1 | **Cruce rechazado** | Dos citas reales del mismo técnico que se cruzan: la segunda da `23P01` en la base y `409 slot_taken` en la tool. También **insertando directo por SQL**, sin pasar por `core-api` |
| A2 | Cruce por el margen | Con margen 30: 10:00–11:00 y 11:15–12:15 se rechaza; 11:30–12:30 se acepta |
| A3 | **Sin contar cancelados ni pruebas** | Un slot `cancelled`, `expired` o `is_test` no bloquea. Otro técnico a la misma hora tampoco |
| A4 | Carrera | Dos `reservar` en paralelo por el mismo horario: exactamente una gana |
| A5 | **Un hold vencido no bloquea el horario** | Con un hold ya vencido, otro contacto reserva ese mismo horario y lo logra; el hold viejo queda `expired`. `horarios_libres` lo ofrece de nuevo |
| A5b | Hold vencido: confirmar | `confirmar` sobre el hold vencido da `409 hold_expired` y no lo revive |
| A5c | Vencimiento en la misma transacción | `reservar` pasa a `expired` los holds vencidos del técnico **y del contacto** antes del `insert`, en la misma transacción. Si el `insert` falla (cruce real), todo se revierte y no queda nada a medias |
| A5d | La exclusión no usa `now()` | Prueba de esquema: `pg_get_constraintdef` de `appointments_no_overlap` no contiene `now()` ni `current_`. Un hold vencido sin marcar **sí** choca si se inserta directo por SQL; es intencional, y el barrido lo limpia |
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

### 9.2 "Sin equivocarse" (pedido de JM, 02/11)

**Objetivo 1 de JM: el agente con el CRM agendando sin equivocarse.** Se traduce en dos reglas verificables. Lo que el modelo escriba no se da por bueno: se compara con la base.

**C1. El bot nunca confirma un horario que la base no reservó.**

| # | Prueba | Se comprueba | Dónde |
|---|---|---|---|
| C1.1 | La base no acepta una confirmación sin hold | Insertar una cita como `confirmed` se rechaza; un hold vencido, cancelado o expirado no se puede confirmar | **Pasa** (CRM-T4) |
| C1.2 | `confirmar` sin hold vigente | `409`, ninguna cita cambia, nada entra en `outbox` | CRM-T6 |
| C1.3 | El mensaje de confirmación lo escribe `core-api` | Al confirmar, `core-api` encola el mensaje con fecha, hora y dirección **leídas de la cita**, no del modelo | CRM-T6 |
| C1.4 | `responder` revisa lo que dice el modelo | Un texto que afirma una cita ("agendado", "confirmado", "scheduled") sin cita confirmada, o con otra fecha u hora que la de la base: `422`, **no entra en `outbox`** y queda registrado | CRM-T6 |
| C1.5 | Prueba adversaria con Claude real | "Confírmame el sábado a las 3" sin disponibilidad, doble reserva y hold vencido. Se comprueba que **todo lo que salió** por `outbox` con una fecha coincide con `core.appointments`. Claude puede variar: el criterio es sobre lo que salió, no sobre sus palabras | CRM-T7 |

**C2. Todos los montos los calcula `core-api`, no el modelo.**

| # | Prueba | Se comprueba | Dónde |
|---|---|---|---|
| C2.1 | La base recalcula siempre | Insertar una cotización con otro total se ignora; se usa el de la lista de precios. El total no se puede editar | **Pasa** (CRM-T4) |
| C2.2 | Los documentos no pueden mostrar otra cifra | El monto del documento sale de su cotización, aunque el que emite escriba otro | **Pasa** (CRM-T4) |
| C2.3 | `cotizar` no acepta montos | Un campo `total` o `precio` en la llamada: `400` por el esquema estricto | CRM-T6 |
| C2.4 | `responder` revisa los montos | Un texto con un monto (`$100`, `100 dólares`, `USD 100`) que no es de la cotización vigente: `422`, **no entra en `outbox`**. Con el total correcto sí sale | CRM-T6 |
| C2.5 | Prueba adversaria con Claude real | "¿Cuánto cuesta sin cotizar?", "hazme 20% de descuento". Todo monto en `outbox` existe en `core.quotes` | CRM-T7 |
| C2.6 | Sin precios fuera de la base | Búsqueda en el código de `core-api` y en el prompt de la copia del workflow: sin tarifas ni mínimos | CRM-T6 y T7 |

**Límite honesto de C1.4 y C2.4:** la revisión busca patrones en el texto. Puede dejar pasar una forma rara de decirlo ("doscientos ocho") y puede frenar una frase legítima. Si frena, el modelo recibe el motivo y reintenta. La protección de fondo son C1.1 a C1.3 y C2.1 a C2.3, que no dependen de lo que escriba. Por eso **el mensaje con la cita y el de la cotización los compone `core-api`**.

### 9.3 Los que hacen falta para confiar en la demo

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

### 9.4 Panel

No hay Chromium instalado en `C:\CRM`. Si lo apruebas (decisión 4), corren los tests `app`. La verificación de la demo se hace en el navegador integrado con el guion: contactos, oportunidades, y citas de solo lectura sin botones de escritura.

### 9.5 Guion de demo (`core-api/dev/demo.ts`)

Con la pila arriba, ejecuta estos escenarios y deja los datos para mirarlos en el panel: cliente nuevo → datos → cotización → horarios → reserva → confirmación; cruce rechazado; hold vencido; firma inválida; duplicado; reasignado; Prueba X; escalar.

## 10. Simulado frente a real

| Pieza | En la Entrega 1 | Para pasarla a real | Quién | Horas |
|---|---|---|---|---:|
| **WAHA** entrante | `dev/waha-sim.ts` firma y envía | Sesión de pruebas de BYTOGAM, webhook **por sesión** apuntando a `core-api`, HMAC con clave real. **Primero una captura real** para confirmar `payload.id`, firma y timestamp | Joel, Sebastián | 1–2 |
| **WAHA** saliente | El simulador recibe `/api/sendText` | Cambiar `WAHA_BASE_URL` y `X-Api-Key`; ajustar el ritmo con Joel | Joel | 0,5 |
| **Bot** | **n8n local con Javier real** (7.7) para la demo, y `dev/mock-bot.ts` para las pruebas automáticas | Llevar el workflow al n8n del VPS: credenciales de ese n8n, URL interna de `core-api`, clave HMAC real y OK de Joel | Sebastián, Joel | 1 (el resto va en la Entrega 1) |
| **Notas de voz** | Se guarda un marcador | Hoy las transcribe n8n. Pasar el audio transcrito a `core-api` | Sebastián | 1 |
| **VPS** | Compose local | Postgres propio, redes separadas, secretos en archivos 600, `core-api` y PostgREST sin puertos publicados | Joel, Sebastián | 4 (CRM-T2) |
| **Login** | Usuario de desarrollo | **POR DECIDIR con Joel:** subdominios y Cloudflare Access | Joel | 5 (CRM-T3) |
| **Permisos** | ADR-001 + `core_api` | OK de Joel: `[BASE]`:130 dice "solo `EXECUTE`", y `crm_api` lee vistas y tablas | Joel | — |
| **Precios y agenda** | Datos de ejemplo, "por confirmar" | JM confirma; se carga una versión nueva con `is_confirmed = true` | JM | 0,5 |
| **Técnico** | Ficticio | Esteban y disponibilidad real | JM | 0,5 |
| **Sesiones** | Nombres de ejemplo | Inventario de WAHA (`[ARQ]`:184): cargar `channels` | Joel | 0,5 |
| **Alertas** | Log local | Discord, sin datos de clientes | Joel | 0,5 |
| **Pruebas reales** | — | 13 casos en el número de BYTOGAM, primero | Todos | CRM-T11 |

**Lo que JM debe saber antes de la demo:** con el ajuste 2, Javier es real (Claude vía n8n local), pero los mensajes son simulados y no hay VPS. Las pruebas automáticas siguen usando el mock del bot, que es determinista. Claude puede variar en cada corrida.

## 11. Decisiones (APROBADAS el 02/11/2026, con los ajustes de la sección 13)

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

n8n del VPS, Cloudflare, sesión real de WAHA, SMS, notas de voz, formulario, descuento por zona y cobertura de ZIP, PDFs (CRM-T14, Entrega 2), importar historial, pausa/reanudar desde el panel, edición de citas, gestión de usuarios, adjuntos, STOP y consentimientos, uso de LLM y auditoría.

**Antes de campañas reales,** STOP y consentimientos son obligatorios (`[BASE]`:67).

## 13. Ajustes de la aprobación (02/11/2026)

| # | Ajuste de Sebastián | Dónde quedó |
|---:|---|---|
| 1 | Holds vencidos: la exclusión no depende de `now()`. `reservar` pasa a `expired` los holds vencidos del técnico, en la misma transacción, antes de insertar. Prueba: "un hold vencido no bloquea el horario" | 6.2 (decisión de diseño 3) y pruebas A5 a A5d |
| 2 | Javier real en la demo: parte local de CRM-T7 con n8n en Docker, copia del workflow TEST sin memoria, mensajes simulados | 7.7, 5 y 10. **+5,5 h** |
| 3 | Dedupe: usar el formato de `payload.id` de la documentación oficial de WAHA, marcado SUPUESTO hasta una captura real | 7.2 |
| 4 | Modelos: CRM-T0b con Sonnet, CRM-T4 con Opus, después Sonnet | Forma de trabajo |
| 5 | Empezar por CRM-T0b en `wip/`. Nada se publica sin "publica <ID>" | 3.5 |
| 6 | Ramas de entrega: cada una se arma sobre la anterior (`crm-t4-…` sobre `crm-t0b-monorepo`), para que los squash no choquen. Publicar CRM-T0b borra `origin/crm-t0-rescate` en el mismo paso | 2.3 y sección 16 |
| 7 | n8n local en 2.43.5, la de producción. La llave de Anthropic la consigue Sebastián. Modelo `claude-sonnet-5-5` | 7.7 |
| 8 | Pedido de JM: CRM-T14 (PDFs) en la Entrega 2, y esquema listo en CRM-T4 | 14 y 15 |
| 9 | "Sin equivocarse": el bot nunca confirma un horario que la base no reservó, y los montos los calcula `core-api` | 9.2 |

## 14. CRM-T14 · PDFs (Entrega 2)

Objetivo 2 de JM: cotizaciones, órdenes de compra y órdenes de trabajo en PDF. **El esquema ya está listo** (sección 15); no se construyó ningún PDF.

### 14.1 Motor

| Opción | Licencia | A favor | En contra |
|---|---|---|---|
| **Gotenberg 8** (recomendada) | MIT (verificado en su `LICENSE`) | Ya es la decisión de `[BASE]`:173. Plantillas HTML fáciles de editar. Sin salida a internet no hay SSRF desde el HTML | Un contenedor más con Chromium: consume RAM, y la RAM del VPS sigue sin conocerse |
| `pdfkit` | MIT (verificado en npm, 0.20.2) | Dentro de `core-api`, sin contenedor, muy liviano | Las plantillas son código: cada cambio de JM pasa por un desarrollador |
| `pdf-lib` | MIT (verificado en npm) | Sin dependencias pesadas | Sin publicar desde 2022. No |
| Puppeteer | Apache-2.0 (**SUPUESTO**, no lo verifiqué) | HTML | Mismo Chromium, sin el aislamiento de Gotenberg |

**Versión propuesta:** `gotenberg/gotenberg:8.38.1` (15/10/2026), fijada, en la red interna, sin salida a internet, con límite de memoria.

**Punto de licencia a revisar antes de vender:** la imagen de Gotenberg incluye herramientas de terceros, entre ellas **PDFtk Java** (su `Dockerfile` la instala). Hasta donde sé es GPL. Corre como un proceso aparte, sin modificar y sin enlazarse a nuestro código, así que para usarla internamente no veo problema. **Si el producto se entrega empaquetado a clientes, hay que revisarlo con un abogado.** No es una opinión legal. El respaldo es `pdfkit`, sin ese tema.

### 14.2 Decisiones

| Tema | Propuesta |
|---|---|
| **Plantillas** | HTML con datos de `core.documents.payload`, en `core-api/templates/`, una por tipo y con versión. Sin plantillas editables desde el panel en esta entrega |
| **Numeración** | Ya resuelta en CRM-T4: `COT-`, `OC-`, `OT-`, sin huecos, con serie aparte para pruebas. **Falta de JM:** el número inicial. El prompt usa "501" como ejemplo |
| **Datos congelados** | El PDF se genera solo desde `payload`, nunca de datos vivos. Regenerarlo da el mismo contenido |
| **Dónde se guardan** | Volumen privado del VPS, fuera de la web, con el nombre `<id>.pdf`. Tabla nueva `core.document_files` con la ruta, el hash SHA-256 y el tamaño, solo de inserción. Entran en los respaldos cifrados (CRM-T12). Cloudflare R2 queda para después |
| **Enlace** | `GET /d/{token}` (`[ARQ]`:215): token aleatorio de 128 bits, **guardado como hash** (`[BASE]`:122), con vencimiento y registro de aperturas. Es ruta pública: depende de CRM-T3 |
| **Envío por WhatsApp** | `POST /api/sendFile` de WAHA con `file.data` (base64), por `outbox`, con el ritmo de siempre. La documentación dice que desde la versión 2026.6.1 lo que era Plus está en Core, incluidos los mensajes multimedia. **Falta confirmar con Joel la versión de producción y probarlo en el número de BYTOGAM.** Respaldo: mandar el enlace por texto |
| **Quién dispara** | Cotización al `cotizar`. Orden de compra al reservar, para que el cliente la confirme (`[SM]`:347-355). Orden de trabajo al `confirmar`, para el técnico |
| **Panel** | Lista de documentos de la oportunidad y descarga |

### 14.3 Estimación

| Tarea | Horas |
|---|---:|
| Gotenberg en Compose, red interna y límites | 0,5 |
| Tres plantillas con marca, en español e inglés | 3 |
| Emisión desde las tools (cotizar, reservar, confirmar) con su `payload` | 1 |
| Generación del PDF, guardado y hash | 2 |
| Envío por `outbox` con `sendFile` y respaldo por enlace | 1,5 |
| Enlace `GET /d/{token}` con vencimiento y aperturas | 1,5 |
| Panel: lista y descarga | 1,5 |
| Pruebas | 2 |
| **Total base** | **12,5** |
| **Con 20% de margen** | **≈15** |

**Lo que necesito de JM antes de empezar:** contenido y datos legales de la orden de compra y la de trabajo (`[ARQ]`:352), número inicial y vigencia de la cotización. **De Joel:** RAM del VPS y versión de WAHA.

**Riesgo:** los textos de esos documentos son compromisos legales. Sin el OK de JM no se emite ningún PDF a un cliente real.

## 15. Resultado de CRM-T4 (02/11/2026, `wip/crm-t4`, sin publicar)

| Pieza | Estado |
|---|---|
| Pila local | `infra/local/docker-compose.yml`: Postgres 17.10 y dos PostgREST v16.4 (desarrollo y pruebas), solo en `127.0.0.1`. Claves aleatorias en `infra/local/.env`, ignorado por git |
| Migraciones | 9 archivos en `db/migrations/`, aplicados por `core_owner` sin superusuario. Runner con checksum |
| Atomic | Línea base generada desde `backoffice/supabase/schemas`, y prueba que falla si cambian o si llega una migración nueva |
| Pruebas | **138 pasan**, contra Postgres y PostgREST reales, con base nueva en cada corrida |
| Mutaciones | Quité 14 reglas una por una (exclusión, margen, inmutabilidad, permisos, dedupe...). **Las pruebas detectaron las 14** |

**Cambios respecto a lo planeado, todos más estrictos:**

| Cambio | Por qué |
|---|---|
| **`is_test`, el margen y el vencimiento del hold los pone la base**, no quien inserta | Si no, una reserva real podía marcarse "prueba" para saltarse la exclusión |
| **Una cita nace como `hold`**, y los cambios de estado están limitados por trigger | "Sin equivocarse": no se puede confirmar algo que no se reservó, aunque la app falle |
| **Los totales los recalcula un trigger** en `core.quotes` | Nadie puede escribir un total, ni `core-api` por error |
| **La numeración va en `core.documents`**, y `core.quotes` ya no tiene número | Un solo sistema para los tres documentos |
| **Contador, no secuencia**, con serie aparte para pruebas | Una secuencia deja huecos al revertir; "Prueba" tampoco debe consumir números reales |
| **Una cita no se puede mover ni borrar** | Se cancela y se reserva otra. Editar citas desde el panel es Entrega 2 |
| `get_avatar_for_email` devuelve `null` y quité la extensión `pgcrypto` y el stub de `http` | Ya no hacen falta |

**Los montos de los documentos:** el trigger reemplaza los montos del `payload` con los de la cotización. El resto del `payload` (cliente, dirección) lo arma la función que emite, en CRM-T6.

**No está en CRM-T4:** las funciones de negocio. `reservar`, con el vencimiento en la misma transacción, va en CRM-T9, y sus pruebas A5, A5b y A5c con ella. Hoy se prueba lo que depende de la base: un hold vencido sin marcar bloquea, y marcado deja de bloquear.

## 16. Cómo se publica

Con la orden "publica <ID>":

| ID | Rama de entrega | Se arma sobre | Además |
|---|---|---|---|
| CRM-T0b | `crm-t0b-monorepo` | `origin/f1-b0-repo-base` | **Borrar `origin/crm-t0-rescate` en el mismo paso** |
| CRM-T4 | `crm-t4-esquema` | `crm-t0b-monorepo` | |
| CRM-T5 en adelante | `crm-tN-…` | La rama de entrega anterior | |

Cada una es un commit nuevo con `git merge --squash` desde su rama `wip/`, y un push solo de esa rama. **Las ramas `wip/` nunca se suben.**

## 17. Resultado de CRM-T5 (02/11/2026, `wip/crm-t5`, sin publicar)

| Pieza | Estado |
|---|---|
| Webhook `POST /hooks/whatsapp` | Verifica canal, firma (HMAC-SHA512 en tiempo constante, 5 min), valida con `zod`, ignora grupos, estados y mensajes propios, normaliza a E.164, redacta tarjetas, y recién entonces escribe. **Responde 200 antes de llamar al bot** |
| Duplicados | Por canal y `payload.id`, con candado en la base: de 5 entregas simultáneas pasa una |
| Resolución | Canal, identidad, titular, contacto, conversación y oportunidad en **una transacción** (`api.ingest_inbound`) |
| Bot | Contexto, token de 15 minutos y llamada firmada. Si falla, un barrido lo reintenta cada 30 s |
| Cola de envío | Ritmo de 2 a 5 s, 3 intentos con espera creciente, sin doble envío con varios trabajadores |
| Proxy del panel | Lista cerrada de 14 recursos y sus métodos. Sin identidad de desarrollo, o en producción, **no existe** |
| Pruebas | **284 pasan** (138 de CRM-T4, 146 nuevas), con Postgres y PostgREST reales |
| Mutaciones | Quité 21 reglas una por una. Las pruebas detectaron las 21; las de pausa del bot necesitaron quitar sus tres protecciones a la vez, porque cada una cubre a las otras |

**Lo que las pruebas encontraron en mi propio diseño, y se corrigió:**

| Hallazgo | Corrección |
|---|---|
| **El id de mensaje de WAHA lleva el teléfono del cliente** (`false_<numero>@c.us_<id>`). Lo iba a mandar a n8n y rompía la regla de que el teléfono completo no viaja | `mensaje.id` es un id propio, `msg_<n>` |
| El historial ordenado por `sent_at` mezclaba el reloj de WAHA con el de la base | Se ordena por orden de llegada |
| El plazo de reasignado se medía contra el reloj de la base, no contra el mensaje | Se mide entre este mensaje y el anterior |
| El primer arreglo del JSON usaba el lector por defecto de Fastify, que **parsea antes de firmar** | Se quitó: el cuerpo se firma tal como llega |

**Criterios del plan que ya pasan:** A15 firma inválida, A16 timestamp viejo, A17 duplicado (y simultáneos), A18 token vencido (a nivel de `verifyConversationToken`; las rutas `/tools/*` que lo usan llegan con CRM-T6), B1 E.164, B2 canal desconocido, B3 ajenos, B12 tarjetas, B15 proxy, y "todo lo que el cliente no debe ver" del contrato.

**No está en CRM-T5, y lo sé:**

- **`confirmar_titular` y el cierre del titular** son CRM-T10. Hoy el contexto solo calcula `reverificar`.
- **Si WAHA o el bot fallan de forma permanente,** nadie recibe aviso: queda en `failed` o sin despachar. Las alertas a Discord son de CRM-T12.
- **`/admin/rest` en producción** responde 404 hasta CRM-T3 (Cloudflare Access).
- **Límite de ritmo por hora** de envíos por sesión (`[ARQ]`:202): solo hay pausa entre mensajes.
- **Un cliente que escribe con dos números** son dos contactos. Fusionarlos es manual.

**Cosas que cambian el plan, para que las decidas:**

1. **Contactos nuevos se llaman "WhatsApp ••0123"** hasta que el bot guarde el nombre. El panel los muestra así.
2. **Un mensaje de un canal desconocido se registra sin firma,** porque no tenemos su secreto para verificarlo. Se limita a una fila por minuto y por sesión, y la ruta es solo red interna. Si prefieres rechazarlo sin registrar, es un cambio de una línea.
3. **`sales_id` de contactos y oportunidades nuevos queda vacío** hasta que exista `core.brands.default_sales_id` (hoy es nulo). El panel funciona, pero nadie es "responsable". Hace falta decidir quién es el responsable de lo que crea el bot.

## 18. Resultado de CRM-T6 (02/11/2026, `wip/crm-t6`, sin publicar)

**Alcance: la mitad del plan, a propósito.** Las herramientas que dependen de la agenda o del titular se hacen con sus funciones, para no escribir rutas que no funcionen:

| Herramienta | Dónde |
|---|---|
| `ficha`, `guardar_datos`, `cotizar`, `escalar`, `responder` | **CRM-T6 (hecho)** |
| `horarios_libres`, `reservar`, `confirmar` | CRM-T9, con la disponibilidad y el vencimiento del hold |
| `confirmar_titular` y "Prueba X" dentro de `guardar_datos` | CRM-T10 |

Por eso **C1.2 y C1.3** (`confirmar` sin hold, y el mensaje de confirmación compuesto por `core-api`) pasan a CRM-T9: necesitan `reservar`.

| Pieza | Estado |
|---|---|
| Autenticación | Token de 15 min, marca verificada contra la conversación, y se sigue `superseded_by` si el número cambió de dueño |
| Esquema estricto | Un campo de más, incluido cualquier id, da 400 en cada herramienta, y la ficha rechaza hasta la query |
| `cotizar` | No acepta ningún monto. Todo lo calcula `core.quote_totals` en la base. Los vectores del prompt dan 346, 1060, 208 y 150 |
| `escalar` | Pausa y crea una tarea. Con la conversación pausada, todas las demás herramientas responden 409 |
| `responder` | Revisa y, si pasa, encola. **C1.4 y C2.4 hechos**; C2.3 y C2.1 también |
| Teléfono | El bot escribe `{{telefono}}` y `core-api` pone el número solo en el mensaje que sale. Cierra la pregunta pendiente con Joel (auditoría, 6.5): el teléfono completo no pasa nunca por n8n |
| Pruebas | **461 pasan** (+177 frente a T5), con Postgres y PostgREST reales |
| Mutaciones | Quité 22 reglas una por una. Las pruebas detectaron 21; la que se escapó (escalar dos veces) está protegida por otra capa y ahora tiene su prueba directa |

**Decisiones tomadas por mí, para que las revises:**

| Decisión | Por qué |
|---|---|
| `apellido` vacío se llena partiendo `nombre` en la primera palabra si el apellido aún es la marca "••1234" | El bot suele guardar "Carlos Pérez" en un solo campo |
| "Hogar" no acepta `pies_cubiertos` y "empresa" no acepta `dormitorios` | El prompt dice que la superficie del hogar se estima por dormitorios y nunca se pregunta |
| Cada área extra **debe** decir si tiene techo | El prompt lo exige ("nunca asumas") |
| Los dominios permitidos son `salvionix.com` y `bioseguridad.bytogam.com` | Salen de los documentos del proyecto. **JM debe confirmarlos** |
| No cuento como "confirmación" la palabra "reservado" | Un hold se explica como "reservado por 15 minutos" y no es una confirmación |

**Límites que conozco:**

- La revisión busca patrones: no detecta un monto en letras ("doscientos ocho"), y una frase legítima rara puede frenarse. La protección de fondo son las reglas de la base.
- **Los horarios que el bot ofrece** (antes de reservar) **no se verifican todavía**: la revisión solo valida horas cuando afirma una confirmación. Con `horarios_libres` (CRM-T9) agrego "solo horarios de la lista".
- La tarea de `escalar` queda **sin responsable** (`sales_id` vacío) hasta que decidas quién lo es.
- **`quote.inputs` guarda lo que mandó el modelo,** ya traducido; el cliente puede ver una cotización distinta si cambia de idea, y la versión anterior queda `superseded`.


## 19. Resultado de CRM-T9 (02/11/2026, `wip/crm-t9`, sin publicar)

| Pieza | Estado |
|---|---|
| `horarios_libres` | Rejilla de "duración + margen" (60 + 30 min de ejemplo: 09:00, 10:30, 12:00, 13:30, 15:00) dentro de la disponibilidad del técnico, en la zona horaria de la marca. Descarta ausencias, aviso mínimo, horizonte y lo ocupado. Máximo 12, el más cercano primero |
| Qué libera un horario | Citas canceladas o expiradas, un hold que ya venció (aunque nadie lo haya marcado), citas de prueba, y el propio hold del cliente |
| `reservar` | Solo un horario **que `horarios_libres` mostró a esa conversación** en el último día. Hold de 15 min |
| Ajuste 1 (hold vencido) | **Hecho.** En la misma transacción: se marcan `expired` los holds vencidos, se suelta el hold anterior del cliente y se prueba técnico por técnico. Si la reserva falla, **no queda nada marcado a medias** (prueba A5c) |
| Concurrencia | **Hecho.** De 2 reservas simultáneas gana 1. De 10 con un técnico gana 1; de 6 con dos técnicos ganan 2, en técnicos distintos |
| `confirmar` | Exige hold vigente, dirección y cotización. Cierra la oportunidad (`won`, que crea la tarea de seguimiento) y **encola el mensaje de confirmación en la misma transacción**. El mensaje lo escribe `core-api` desde la cita, no el modelo |
| Ajuste 2 (responder) | **Hecho.** `responder` rechaza (`schedule_not_offered`) cualquier hora que no salió de `horarios_libres` en esa conversación, y fechas o días de la semana en las frases que hablan del servicio. Las fechas de emisión y vigencia de una cotización no se tocan |
| Responsable por defecto | Columna `core.brands.default_sales_id` (configurable por marca, no fija). Contactos, oportunidades y la tarea de `escalar` y de venta cerrada se asignan a esa persona. En la demo: Sebastián; en producción lo define JM. Probado con cambio de responsable, marca sin responsable y persona inexistente |
| Pruebas | **545 pasan** (+84 frente a T6), con Postgres y PostgREST reales |
| Mutaciones | Quité 23 reglas una por una. Las pruebas detectaron 22; la que se escapó ("ya agendado puede reservar otra vez") estaba cubierta por otra capa y ahora tiene su prueba directa |

**Lo que cambió respecto del plan**

| Cambio | Por qué |
|---|---|
| Un hold vencido **sí bloquea** si se inserta directo por SQL sin marcarlo | La exclusión no puede mirar el reloj. `horarios_libres` y `reservar` lo ignoran; el barrido (`api.expire_holds`, cada 60 s) lo limpia |
| El bot **no puede aceptar la hora que propone el cliente** | Cumple "el bot ofrece, no acepta" (auditoría, fila 12). Si el cliente pide una hora libre, el bot la busca con `horarios_libres` y la ofrece |
| Una hora final solo se acepta junto con la inicial ("de 10:00 a 11:00") | Si no, la hora de fin de un horario ofrecido pasaba como si fuera otro horario. Lo encontró una prueba |
| `confirmar` exige cotización | Sin precio no hay venta |

**Un fallo de mi SQL que las pruebas encontraron:** la regla "se necesita una cotización" nunca se aplicaba, porque una cotización ausente es un `null` de JSON y no de SQL. Quedó corregido y probado.

**Límites que conozco**

- El margen (30 min), el aviso mínimo (120 min) y el horizonte (14 días) son **valores míos de ejemplo**, marcados "por confirmar" con JM.
- Las horas de otros usuarios de WhatsApp en frases del bot ("Mi horario de atención es de 9 a 5") también se rechazan: son horas que no salieron de `horarios_libres`. Si JM quiere comunicar un horario de atención, hace falta una regla aparte.
- Palabras relativas ("mañana", "hoy") no se verifican: solo horas, fechas y días de la semana explícitos.
- No probé el cambio de hora de verano con `horarios_libres`: el horizonte es de 14 días y hoy no hay un cambio en ese rango. Lo cubre la prueba de la revisión de textos (invierno y verano) y la conversión de zona.


## 20. Resultado de CRM-T10 (02/11/2026, `wip/crm-t10`, sin publicar)

| Pieza | Estado |
|---|---|
| `confirmar_titular` | `es_la_misma_persona` y, si es otra, `nombre_nuevo`. Solo funciona **mientras haya una verificación pendiente** (más de `reverify_after_days` de silencio entre dos mensajes y sin respuesta todavía): el modelo no puede usarla para borrar el contexto de un cliente cuando quiera |
| Misma persona | Se anota la verificación y todo sigue igual: sin contacto nuevo, sin conversación nueva |
| Otra persona | En una transacción: se cierra el período del titular, se crea un contacto y una oportunidad nuevos, se cierra la conversación (`superseded_by`) y se abre otra. **Lo dicho desde el mensaje que rompió el silencio, con las respuestas, pasa a la conversación nueva**, porque lo dijo la persona nueva |
| El dueño anterior | Conserva todo: contacto, datos, historial anterior al silencio, cotizaciones, oportunidades y citas confirmadas. La persona nueva no ve nada de eso: ni en la ficha ni en el historial que recibe el bot |
| Token de la conversación vieja | Sigue valiendo hasta vencer y **actúa sobre la conversación nueva**, nunca sobre los datos del dueño anterior (criterio A10) |
| "Prueba X" | Un contacto cuyo nombre empieza con "Prueba" (sin distinguir mayúsculas ni espacios) queda marcado, y la marca pasa a sus oportunidades y a sus citas activas. **Es un trigger de la base, no código de la aplicación**: vale también para el panel, las importaciones y el nombre de WhatsApp (`pushName`) |
| Citas de prueba | No bloquean la agenda real, tampoco si el nombre se descubre tarde: un horario ya reservado queda libre al marcarse como prueba (A12 y A13) |
| Numeración | Las pruebas usan su propia serie (`PRUEBA-COT-…`), y toda marca nueva recibe sus series al crearse |
| Pruebas | **579 pasan** (+34), con Postgres y PostgREST reales |
| Mutaciones | Quité 14 reglas una por una, entre ellas la de pendiente, el cierre del período, el movimiento de mensajes, la regla del nombre y su propagación. Las pruebas detectaron las 14 |

**Criterios del plan que ya pasan:** A7, A8, A9, A10, A11, A12, A13, A14.

**Hallazgos de las pruebas, corregidos**

| Hallazgo | Corrección |
|---|---|
| **Reservas simultáneas podían terminar en error 500.** Con dos técnicos y seis clientes a la vez, Postgres a veces detecta un interbloqueo (deadlock) entre dos inserciones que chocan contra una restricción de exclusión, en vez de rechazar una con un error limpio | `reservar` ahora entra en fila **por marca** (candado `pg_advisory_xact_lock`): reservar es poco frecuente y así no hay interbloqueo. La prueba repite 5 rondas, porque el fallo dependía del azar |
| La marca "prueba" no se propagaba a las oportunidades | El trigger que propaga disparaba solo con `update of is_test`, y un cambio hecho por otro trigger no cuenta como columna de la sentencia. Ahora dispara con cualquier `update` |
| Una marca nueva no tenía series de documentos | Un trigger las crea al crear la marca |

**Límites que conozco**

- **Una inserción directa en SQL de dos citas que chocan a la vez** puede dar `23P01` (choque) o `40P01` (interbloqueo): en los dos casos una se rechaza. La prueba acepta ambos.
- **"Prueba" como primer nombre real** (un cliente que se llame así) queda marcado como prueba: se corrige a mano. Lo contrario, un apellido "Prueba", no marca.
- **Nada desmarca solo.** Si alguien marcó por error un cliente real, hay que cambiar `is_test` a mano.
- **El plazo de reasignación** (90 días de ejemplo; el Router de TEST usa 180) sigue por confirmar con JM.


## 21. Resultado de CRM-T8a (02/11/2026, `wip/crm-t8a`, sin publicar)

**T8a = panel de lectura con contactos, oportunidades y citas.** Lo que falta de T8 (login con Access, conversación en la ficha, quitar lo no usado) queda para la Entrega 2.

| Pieza | Estado |
|---|---|
| Proveedor definitivo | `backoffice/src/components/atomic-crm/providers/core-api/`, que viene del spike (`wip/crm-t1`). Ya no lleva token ni `VITE_SPIKE_TOKEN`: el navegador solo habla con `core-api` (`/admin/rest/*`) |
| Selección por configuración | `VITE_DATA_PROVIDER=core-api` (y `VITE_CORE_API_URL`) en `backoffice/src/App.tsx`. Sin la variable, sigue Supabase. **`CRM.tsx` ya no tiene atajo**: solo se le suma el recurso de citas |
| Identidad | Nueva ruta `GET /admin/session`: `core-api` dice quién es el usuario (hoy `ADMIN_DEV_SUB`, el responsable de la demo; con Access será el usuario real). Devuelve nombre, id y rol, nada más. La CORS acepta cookies solo del origen del panel |
| Citas | Recurso `appointments` de solo lectura sobre `appointments_summary`: fecha y hora, estado (con "Prueba" aparte), cliente y oportunidad con enlace, técnico y dirección. Filtro por estado. Sin botones de crear, editar ni borrar; si algo intentara escribir, el proveedor lo rechaza |
| Menú | Pestaña "Citas" en español, inglés y francés |
| Lo que no funciona sin Supabase | Registro, usuarios, contraseñas, combinar contactos: dicen claramente que necesitan una ruta de `core-api` (Entrega 2). No se llama a Supabase |
| Datos de demostración | `db/seeds/demo/` y `npm run db:seed-demo`: 5 contactos ficticios, 5 oportunidades y 3 citas (una confirmada, dos provisionales, una de prueba) |
| Pruebas | Panel: **316 pasan** (44 archivos, 20 nuevas: proveedor, auth y lista de citas). `core-api`: **584 pasan** (+5: `/admin/session` y CORS). Lint, typecheck y `build:demo` bien |
| Verificado en el navegador | `core-api` y el panel levantados en local con la base de demostración: la lista de citas con filtro por estado, los contactos y el tablero de oportunidades cargan por `core-api` |

**Cómo verlo** (desde `core-api/`, con Docker): `npm run local:up`, `db:bootstrap`, `db:migrate`, `db:seed`, `db:seed-demo`, `npm start`; y desde `backoffice/`: `VITE_DATA_PROVIDER=core-api npm run dev`.

**Lo que cambió en `backoffice/`** (para `UPSTREAM.md`): `App.tsx`, `root/CRM.tsx` (un recurso), `layout/Header.tsx` (una pestaña), los tres catálogos de mensajes, y las carpetas nuevas `appointments/` y `providers/core-api/`.

**Límites que conozco**

- **Los clientes y oportunidades de prueba se ven en el panel** (la cita lleva la marca "Prueba", pero no hay un filtro). Sacarlos de reportes y del tablero principal es Entrega 2.
- **Las horas de la lista salen en la zona horaria del navegador**, no la de la marca. Para Orlando, quien mire desde Ecuador verá la hora de Ecuador.
- **El tablero muestra un aviso de React** ("Cannot update a component while rendering") en la consola. Viene del código del upstream (el filtro de autocompletado), no de lo nuestro; no afecta el uso.
- **Producción:** con `NODE_ENV=production` no existe ni el proxy ni la sesión, hasta que llegue Access (CRM-T3).


## 22. Resultado de CRM-T11, parte sin Claude (03/11/2026, `wip/crm-t11`, sin publicar)

**Lo que falta de T11** (la demo con Javier en n8n y Claude) espera a CRM-T7a, que necesita la llave de Anthropic. Esta parte deja listo todo lo demás y deja la demo corriendo hoy con un bot de guion.

| Pieza | Estado |
|---|---|
| Simulador de WAHA | `core-api/dev/waha-sim.ts`: webhook firmado (HMAC-SHA512 en hexadecimal, encabezados `x-webhook-*`), mensajes de texto, nombre que muestra WhatsApp, duplicados (mismo `payload.id`) y teléfonos ficticios. También hace de WAHA para lo que sale: recibe `POST /api/sendText` y guarda lo enviado |
| Bot de guion (mock) | `core-api/dev/mock-bot.ts`: verifica la firma de `core-api`, contesta 200 y trabaja por las mismas herramientas con el token que recibe. Sin Claude y con frases fijas. Pregunta siempre el nombre (el de WhatsApp es solo un apodo) |
| Guion | `core-api/dev/demo.ts`, `npm run demo`: cliente nuevo; cliente que vuelve y es reconocido; cotización; horarios, reserva y confirmación; cruce rechazado; escalar; "Prueba X"; número reasignado; más un duplicado y una firma falsa. **42 comprobaciones**, todas en la base y en lo enviado, no en lo que dice el bot |
| Segundo plano | `src/background.ts`: la cola de envío, el barrido de entregas pendientes y el vencimiento de reservas provisionales salen de `server.ts` a un módulo que también usan las pruebas |
| Documentación | `docs/DEMO.md` (guion paso a paso) y `core-api/README.md` |
| Pruebas | `core-api/test/demo.test.ts` corre el guion completo contra un servicio real y una base real, más pruebas del simulador y del bot de guion (firma, llave, duplicados, 401). La demo también corrió dos veces seguidas por la línea de comandos |

**Dos arreglos que salieron de correr el guion de punta a punta**

| Hallazgo | Corrección |
|---|---|
| La herramienta `ficha` devolvía `tipo_cliente` como `home`/`business` mientras que las demás herramientas piden `hogar`/`empresa`: un bot que repitiera lo que lee fallaba | `ficha` traduce a `hogar`/`empresa` |
| Elegir un horario que otro cliente ya tomó mostraba un error genérico | Los códigos `CX002`, `CX003`, `CX005` y `CX006` se devuelven como 409 con una razón (`invalid_state`, `hold_expired`, `slot_taken`, `slot_not_offered`) para que el bot sepa qué decir |

**Límites que conozco**

- **El bot de guion no entiende lenguaje libre**: prueba el circuito (firma, herramientas, revisión, envío), no la conversación. Si Javier dice algo distinto, la demo con n8n puede dar ❌ en una comprobación que el guion hace pasar.
- **Los supuestos sobre WAHA** (formato de `payload.id`, codificación de la firma, unidad del timestamp) siguen sin una captura real.
- **Margen entre servicios, aviso mínimo, horizonte y disponibilidad del técnico** son valores de ejemplo, por confirmar con JM.


## 23. Resultado de CRM-T8b (03/11/2026, `wip/crm-t8b`, sin publicar)

**T8b = panel completo:** la ficha con la conversación, el cambio de etapa, las tareas y los clientes de prueba fuera de los reportes y del tablero.

| Pieza | Estado |
|---|---|
| Conversación en la ficha | Pestaña "Conversación" (primera) junto a "Notas" en la ficha del contacto, también en el teléfono. Muestra los mensajes en orden, quién los dijo (Cliente, Javier, Equipo) y la hora; el `{{telefono}}` que deja el bot se muestra con el número real. Solo lectura: se contesta desde WhatsApp. Sale de la vista `conversation_messages`, que solo lee el panel. Un contacto conserva lo dicho mientras el número fue suyo, aunque después se reasigne |
| Cambio de etapa | Selector de etapa en la ficha del contacto (sección "Oportunidades") y en la ventana de la oportunidad. La oportunidad pasa al final de la columna nueva, como al soltar una tarjeta. Si el servidor lo rechaza, no se avisa de un cambio que no ocurrió |
| Tareas | Ya estaban en la ficha (crear, completar, editar, borrar). Se comprobó contra `core-api`: el responsable se completa solo y la tarea de un cliente de prueba nace marcada como prueba |
| Clientes de prueba | Salen de las listas de contactos, oportunidades (tablero y archivadas), tareas, notas, actividad y citas, y de los gráficos del panel principal. Opción "Mostrar clientes de prueba" en el menú de usuario, que lo recuerda en este navegador. **La ficha de un cliente de prueba sí muestra lo suyo** (sus tareas, notas y oportunidades): lo que se oculta son las listas generales |
| Base de datos | Migración `0014_panel.sql`: vista `conversation_messages`; columna `is_test` en tareas y notas, que se pone sola al crearlas y se propaga cuando un cliente pasa a ser de prueba; `is_test` en `contacts_summary` y en `activity_log`; la fila de configuración del panel (sin ella el panel no arrancaba en una base nueva) |
| `core-api` | `conversation_messages` solo en lectura. El `getOne` del panel pide un objeto y el proxy ya no lo convierte en lista de uno (con eso, la ficha no cargaba) |
| Arreglo de paso | Cuando `responder` rechazaba un texto, el servicio registraba un aviso "Reply was already sent" por cada rechazo. La respuesta salía bien; era ruido, ya no |
| Pruebas | `core-api`: **603 pasan** (+10: vista, triggers, permisos, proxy). Panel: **343 pasan** (+27: conversación, selector de etapa, proveedor). Verificado en el navegador con la demo corriendo: conversación, cambio de etapa en la base, tablero sin pruebas, la opción del menú, tareas por `core-api` |

**Límites que conozco**

- **La marca de prueba nunca se quita sola.** Si alguien marcó a un cliente real, hay que cambiar `is_test` a mano; no hay botón en el panel.
- **Las notas ya existentes** de un cliente de prueba se marcan al aplicar la migración solo si el cliente ya estaba marcado cuando se creó la nota o cuando pasó a prueba; no se recorre el historial anterior (en la base de demostración no había).
- **El panel principal** muestra la guía "Qué sigue" mientras no haya notas reales (viene del upstream).
- **La búsqueda global** sigue encontrando clientes de prueba: es lo esperado cuando alguien busca por nombre.
- **La conversación carga los primeros 500 mensajes como máximo** (en orden cronológico) y no se actualiza sola: se ve al abrir la ficha o al refrescar.


## 24. Resultado de CRM-T9b (03/11/2026, `wip/crm-t9b`, sin publicar)

**T9b = calendario editable:** vista semanal por técnico; crear, confirmar, cancelar y reprogramar citas a través de `core-api`, con las mismas reglas del bot; y gestión de la disponibilidad.

| Pieza | Estado |
|---|---|
| Vista | "Citas" abre ahora el calendario (la tabla de solo lectura queda en el botón "Lista"). Una semana, de lunes a domingo, de **un técnico a la vez** (selector). Se dibuja **con el reloj de la marca** (hoy `America/New_York`), no el del navegador: una cita de las 15:00 UTC sale a las 10:00 en invierno y a las 11:00 en verano. Sombreado verde = horas en que el técnico atiende; gris = ausencia; bloques: ámbar = reservada (hold), verde = confirmada, borde discontinuo = de prueba. Canceladas y vencidas no se dibujan |
| Crear | Botón "Nueva cita" o clic en un hueco (se redondea a la media hora). Se busca la oportunidad por nombre (se muestra con el cliente y la etapa, porque varias se llaman igual), día, hora, técnico y dirección. Con "Confirmar ahora" se reserva y confirma en el mismo paso |
| Confirmar / cancelar / reprogramar | Desde el bloque. Cancelar pregunta antes. Reprogramar es cancelar y reservar **en una transacción**: si el horario nuevo está ocupado, la cita sigue donde estaba. Una cita confirmada sigue confirmada; una reservada recibe una reserva nueva de 15 min |
| Las reglas (en la base, migración `0015_calendar.sql`) | Igual que el bot: sin cruces (la restricción de exclusión, con el margen); una reserva a la vez por marca; el horario debe estar dentro de la disponibilidad del técnico y fuera de sus ausencias; no puede estar en el pasado; confirmar exige dirección y una cotización enviada, y deja la oportunidad en "Servicio contratado"; un servicio con cita confirmada no admite otra; un cliente tiene una reserva a la vez. **Distinto del bot a propósito:** el personal **no** está limitado por el aviso mínimo ni por el horizonte de días (puede agendar a 3 semanas), y puede elegir cualquier hora dentro de la ventana, no solo la cuadrícula de horarios ofrecidos |
| Disponibilidad | Diálogo "Disponibilidad": ventanas semanales por día (varias por día) y ausencias con fechas y motivo. Se reemplazan las ventanas completas. **No se tocan las citas ya reservadas:** el aviso dice cuántas quedaron fuera del horario o cubiertas por la ausencia, para reprogramarlas |
| `core-api` | 7 rutas nuevas bajo `/admin/agenda/*` (documentadas en `ROUTES.md`, comparadas con las registradas por una prueba), esquema estricto, solo con identidad de desarrollo y nunca en producción. Cada rechazo de la base llega como `{ error, reason }` (por ejemplo `slot_taken`, `address_required`); nunca SQL. El panel no tiene permiso de escritura sobre el esquema `core`: solo `core_api` ejecuta las funciones |
| Arreglo de paso | `db:migrate` ahora avisa a PostgREST que recargue el esquema: sin eso una vista nueva daba 404 hasta reiniciarlo |
| Pruebas | `core-api`: **658 pasan** (+55: 30 de la base, 17 de las rutas, permisos). Incluye 8 reservas simultáneas del mismo horario en 5 rondas (una gana por técnico, el resto recibe un rechazo limpio) y una comprobación de que quitar el candado por marca hace fallar la prueba. Panel: **371 pasan** (+28: aritmética de fechas incluyendo el cambio de hora de noviembre, la semana, reservar, confirmar, cancelar, reprogramar, disponibilidad). Verificado en el navegador con la demo: reservar, rechazo por horario ocupado, reprogramar, el aviso de "falta cotización" y el diálogo de disponibilidad |

**Límites que conozco**

- **Un técnico por vista.** No hay una vista de todos los técnicos juntos.
- **El calendario es de la marca del técnico.** Con varias marcas, cada técnico muestra su zona horaria.
- **Confirmar desde el panel no le escribe al cliente.** El bot manda el mensaje de confirmación por WhatsApp; cuando confirma una persona, el aviso al cliente lo hace ella.
- **Cancelar una cita confirmada no cambia la etapa** de la oportunidad (sigue en "Servicio contratado"): se cambia a mano con el selector de etapa.
- **No hay historial de quién hizo qué.** Hoy el usuario es el de desarrollo; con Access (CRM-T3) se guardará quién agendó, canceló o movió.
- **Las ventanas de disponibilidad** se guardan sin tocar las citas existentes por decisión: cambiar el horario no cancela a nadie.
- **Los documentos** (orden de compra y de trabajo) no se generan todavía (CRM-T14, Entrega 2): cuando existan, cancelar o mover una cita confirmada tendrá que anularlos.
- **Dispositivos táctiles:** la cuadrícula se desplaza en horizontal en pantallas estrechas; no se probó en teléfono.
