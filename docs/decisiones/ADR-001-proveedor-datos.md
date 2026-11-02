# ADR-001 · Proveedor de datos del CRM: PostgREST interno (C) o rutas a medida (B)

- **Fecha:** lunes 02/11/2026 (hora de Guayaquil)
- **Tarea:** CRM-T1 (spike), rama `crm-t1-spike-postgrest`, solo local (no se mezcla ni se sube)
- **Estado:** PROPUESTO. Falta el OK de Joel sobre los permisos de la sección 4.
- **Decide:** Sebastián, con el doble check de Joel (infraestructura y permisos).

## 1. Contexto

La auditoría (`docs/auditoria/AUDITORIA_SALVIONIX_CRM_20261102.md`, sección 6) recomendó no usar Supabase en producción. En su lugar, un `dataProvider` delgado que hable con `core-api`, que reenvía a un PostgREST interno con un rol limitado (opción **C**). El respaldo era escribir rutas `/admin/*` a medida (opción **B**). El spike debía decidir con evidencia.

## 2. Qué se probó

Todo en local, solo en `127.0.0.1`, con datos ficticios (60 contactos, 40 oportunidades, 20 tareas) y sin tocar ningún servidor.

| Pieza | Versión / detalle |
|---|---|
| Base | `postgres:17.10` (puerto 55432) |
| PostgREST | `postgrest/postgrest:v16.4` (puerto 55300) |
| Esquema | `supabase/schemas/01…08` **sin modificar**, más una capa mínima que simula `auth.uid()`, `auth.users`, `storage` y `net.http_post` (`spike/postgrest/00_stub.sql`) |
| Rol de la API | `crm_api`, sin login, sin `postgres`. PostgREST entra como `authenticator` y cambia a `crm_api` según el claim `role` del JWT |
| Rol sin token | `crm_anon`, sin ningún privilegio |
| Frontend | `src/components/atomic-crm/providers/postgrest/` (4 archivos), con `@raphiniert/ra-data-postgrest` 2.6.0 (ya estaba en `node_modules`) y un `httpClient` propio. `CRM.tsx` apunta a ese proveedor en esta rama |
| Reproducir | `spike/postgrest/load.ps1 -EnvFile <archivo fuera del repo> -Seed`. Las claves se generan fuera del repo |

## 3. Qué funcionó

Verificado en la interfaz real (Vite, puerto 5199) y con llamadas directas al API. El typecheck de toda la app pasa.

| Prueba | Resultado | Evidencia |
|---|---|---|
| Panel principal carga | Funciona | Peticiones a `configuration`, `sales`, `contacts_summary`, `deals` → 200/206 |
| Lista de contactos (`contacts_summary`) | Funciona | `GET /contacts_summary?offset=0&limit=25&order=last_seen.desc.nullslast` → 206, con `Content-Range` (total correcto: `5-9/60`) |
| Filtro por estado + búsqueda + orden + paginación | Funciona | `…limit=5&status=eq.hot&or=(first_name.ilike.*Prueba3*,…)&order=first_name.asc` → 200 |
| Oportunidades (Kanban) | Funciona | `GET /deals?…archived_at=is.null&order=index.desc.nullslast` → 200; filtro por etapa `stage=eq.proposal-sent` → 6 de 40 |
| Crear contacto desde el formulario | Funciona | `POST /contacts` → 201, redirige a la ficha. `sales_id` y avatar los llena un trigger; `fts` es una columna generada |
| Editar contacto desde el formulario | Funciona | La base queda con el apellido nuevo (verificado con consulta) |
| Crear y editar oportunidad | Funciona | `POST /deals` → 201; `PATCH /deals` → 200 |
| Oportunidad a "Servicio contratado" crea la tarea de seguimiento | Funciona **con un permiso extra** (sección 4) | Se crea `deal_followup_events` y la tarea "Dar seguimiento al servicio contratado: …" |
| Búsqueda global (`global_search`) | Funciona como `rpc` | `POST /rpc/global_search` → 200 |
| Reconstruir todo desde cero | Funciona | `load.ps1 -Seed` deja el mismo resultado |

**Lo que hay que saber:** el API **no** cambió el frontend más que en el `dataProvider` y el `authProvider`. Los filtros de la app (`@or`, `@ilike`, `status`, etc.) ya son sintaxis PostgREST, por eso pasan sin traducción.

## 4. Permisos exactos del rol de PostgREST (para Joel)

Estos son los **únicos** permisos de `crm_api`. Todo lo demás está denegado. Sale de `spike/postgrest/90_roles.sql` y se verificó contra el catálogo (`information_schema`).

| Tipo | Objeto | Permisos | Para qué |
|---|---|---|---|
| Tablas | `companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`, `tags`, `tasks` | SELECT, INSERT, UPDATE, DELETE | CRUD de la app |
| Tabla | `configuration` | SELECT, UPDATE | Configuración de la app |
| Tabla | `sales` | SELECT; UPDATE solo de `first_name`, `last_name`, `avatar` | Perfil propio |
| Tabla | `deal_followup_events` | SELECT, INSERT | Lo inserta el trigger de "oportunidad ganada" (sección 6) |
| Vistas | `activity_log`, `contacts_summary`, `companies_summary` | SELECT | Listas y actividad (son `security_invoker`, así que aplican las políticas de las tablas) |
| Secuencias | las 9 de `public` | USAGE | Ids de los INSERT |
| Esquemas | `public`, `auth`, `extensions` | USAGE | `auth` por `auth.uid()` y `extensions` por `digest` en el trigger de avatar |
| Funciones | `auth.uid()`, `public.is_admin()` | EXECUTE | Triggers y políticas |
| Funciones | `public.global_search`, `search_document`, `search_unaccent`, `search_query`, `search_attachment_titles` | EXECUTE | Búsqueda y columnas `fts` generadas (se evalúan con los derechos de quien escribe) |
| Funciones | `public.get_avatar_for_email`, `public.get_domain_favicon` | EXECUTE | Trigger `handle_contact_saved` |

**Lo que NO tiene** (probado): `auth.users`, `storage`, `user_invitations`, `favicons_excluded_domains`, `merge_contacts()`, `get_user_id_by_email()`, DELETE en `sales`, UPDATE de `sales.administrator`. Sin token, `crm_anon` recibe 401. Un token firmado con `role=postgres` recibe 403 ("permission denied to set role"). Un token alterado recibe 401.

### 4.1 Cosas que Joel debe saber

1. **La autorización real es de `core-api`, no de la base.** Las políticas RLS dicen `using (true)` para `authenticated` (`supabase/schemas/05_policies.sql`). Prueba: un token válido con un `sub` que **no existe** en `sales` lee todo y puede crear contactos (quedan con `sales_id` nulo). Por eso el JWT solo lo debe firmar `core-api`, solo para personas dadas de alta, y PostgREST nunca debe quedar expuesto fuera de la red interna.
2. **Las funciones con EXECUTE quedan expuestas como `rpc/…`.** PostgREST publica `get_avatar_for_email`, `get_domain_favicon` y las `search_*` como endpoints porque el trigger las necesita con los derechos del llamador. `core-api` debe permitir solo `rpc/global_search` y dejar fuera el resto.
3. **Los privilegios por defecto de Postgres no son seguros.** El esquema, tal como viene, da `grant all` a `anon` y `service_role` (`06_grants.sql`), y las funciones nacen con EXECUTE para `PUBLIC`. El spike los **revoca todos** antes de dar nada (`90_roles.sql`, paso 1). Hay que hacer lo mismo en el servidor.
4. **El esquema y las migraciones no coinciden en un permiso.** `supabase/migrations/20261031210000_deal_followup_on_win.sql` da SELECT e INSERT en `deal_followup_events` a `authenticated`, pero `supabase/schemas/06_grants.sql` (la fuente de verdad) **no**. Con solo el esquema, ganar una oportunidad falla con `permission denied for table deal_followup_events`. Se reporta aquí; no se corrigió porque está fuera del alcance del spike.

### 4.2 `90_roles.sql` completo

```sql
-- CRM-T1 spike: privileges of the PostgREST role. This file is the permission list for Joel.
-- Principle: nothing is granted by default; everything below is explicit.

-- 1. Strip what the Supabase-style 06_grants.sql gave to the placeholder roles.
revoke all on all tables    in schema public from anon, authenticated, service_role, public;
revoke all on all sequences in schema public from anon, authenticated, service_role, public;
revoke all on all functions in schema public from anon, authenticated, service_role, public;
revoke all on schema public from anon, authenticated, service_role, crm_anon, crm_api;

-- 2. crm_api: what the CRM frontend may do.
grant usage on schema public to crm_api, crm_anon;

grant select, insert, update, delete on
  public.companies, public.contacts, public.contact_notes, public.deals, public.deal_notes,
  public.tags, public.tasks
to crm_api;

grant select, update on public.configuration to crm_api;
grant select on public.sales to crm_api;
grant update (first_name, last_name, avatar) on public.sales to crm_api;

-- Views (security_invoker = on, so RLS of the underlying tables still applies)
grant select on public.activity_log, public.contacts_summary, public.companies_summary to crm_api;

-- Sequences used by inserts
grant usage on all sequences in schema public to crm_api;

-- Functions the frontend calls directly (rpc) or that policies/triggers evaluate as crm_api
grant execute on function public.is_admin() to crm_api;

-- 3. Found during the spike (create contact / create deal failed without them).
-- The trigger functions below are NOT security definer, so they run with crm_api's rights.
--   set_sales_id_default()  calls auth.uid()
--   handle_contact_saved()  calls get_avatar_for_email() -> extensions.digest / extensions.http_get
grant usage on schema auth to crm_api;
grant execute on function auth.uid() to crm_api;
grant usage on schema extensions to crm_api;
grant execute on function public.get_avatar_for_email(text), public.get_domain_favicon(text) to crm_api;
-- 4. Search helpers used by the generated/trigger-maintained fts columns and by the global_search rpc.
grant execute on function
  public.search_document(variadic text[]), public.search_unaccent(text),
  public.search_query(text), public.search_attachment_titles(jsonb[]),
  public.global_search(text, text[], integer)
to crm_api;
-- 5. Won-deal follow-up: create_deal_followup_on_win() is not security definer and inserts into this table as crm_api.
-- Note: migration 20261031210000 grants select, insert to "authenticated"; supabase/schemas/06_grants.sql does not (drift, reported in ADR-001).
grant select, insert on public.deal_followup_events to crm_api;
```

## 5. Qué se rompe sin Supabase y qué haría falta

| Función de la app | Depende de | Qué pasa hoy en el spike | Qué hace falta | Horas |
|---|---|---|---|---:|
| `signUp` | Supabase Auth | Lanza error "no disponible" | No aplica con Cloudflare Access (login del equipo). Alta de personas por una ruta de `core-api` que crea la fila en `sales` | 1,5 |
| `salesCreate` / `salesUpdate` | Edge Function `users` (Auth admin) | Lanza error | Rutas `/admin/sales` en `core-api` que escriben `sales` (sin contraseñas) | 2 |
| `updatePassword` | Edge Function `update_password` | Lanza error | Quitar la pantalla (Access no usa contraseña) | 0,5 |
| `mergeContacts` | Edge Function `merge_contacts` → SQL `merge_contacts()` (solo `service_role`) | Lanza error | Ruta en `core-api` con un rol aparte que tenga EXECUTE (no `crm_api`) | 1,5 |
| `globalSearch` | rpc `global_search` | **Funciona** | Dejar solo esa ruta `rpc` | 0 |
| Adjuntos y logos (Storage: `uploadToBucket`, `createSignedUrl`) | Storage de Supabase | Se omite la subida; el trigger `cleanup_note_attachments` llama a `net.http_post` (simulado) | Fuera del MVP. Para activarlo: carga por `core-api` a disco o MinIO | 3 a 4 (después) |
| Avatar por correo (`get_avatar_for_email`) | Extensión `http` (no viene en la imagen oficial) | Devuelve `"ERROR"` (la función lo captura) | Quitarlo o moverlo a `core-api` | 0,5 |
| `isInitialized` / `init_state` | Auth + vista | Sustituido por `true` | Nada: ya no hay pantalla de primer registro | 0 |
| Login, sesión, `getIdentity`, `canAccess` | Supabase Auth | `authProvider` propio de 60 líneas: toma `sub` del token y busca en `sales` | Con Access, `core-api` valida el JWT de Access y emite el suyo | (en CRM-T5 y CRM-T8) |
| `sales.user_id` → `auth.users`, triggers `on_auth_user_*`, `is_admin()` con `auth.uid()` | Tabla `auth.users` | Funcionan con la tabla simulada | Producción necesita una tabla propia de usuarios y quitar el FK, o conservar un `auth.users` mínimo | 1,5 |

## 6. Nueva estimación

Base de la auditoría (sección 8.2): CRM-T4 = 11 h, CRM-T8 = 7 h.

| Tarea | Con **C** (PostgREST interno) | Con **B** (rutas a medida) | Por qué |
|---|---:|---:|---|
| **CRM-T4** esquema y permisos | **12,5 h** (+1,5) | **12,5 h** (+1,5) | El esquema carga sin cambios. Se suma desconectar `auth.users` (FK, triggers, `is_admin`). Con C el rol limitado queda definido en `90_roles.sql` (ya probado) |
| **CRM-T8** panel | **≈ 9 h** (+2) | **≈ 23 a 29 h** (+16 a +22) | C: el proveedor y el `authProvider` ya están escritos (≈1 h), se suman rutas de la sección 5 y quitar lo no usado. B: hay que reescribir listas, filtros (`@or`, `@ilike`, `@in`), orden, conteo y paginación para unos 9 recursos, más las rutas de la sección 5 |
| **Efecto en el MVP** | **≈ +3,5 h** (de 75,5 a ≈ 79 h) | **≈ +17 a +24 h** | El 20% de margen de la auditoría ya cubre el caso C |

Las horas de la sección 5 que caen en `core-api` (alta de personas, merge) se cuentan dentro de CRM-T5 y CRM-T8. No se sumaron dos veces.

## 7. Recomendación

**Seguir con C**, con estas condiciones:

1. **PostgREST nunca sale de la red interna.** Solo `core-api` le habla, y `core-api` filtra qué `rpc` y qué recursos pasan (lista cerrada, en `ROUTES.md`).
2. **El JWT lo firma solo `core-api`**, con vida corta, para personas existentes en `sales`. Es la única barrera real (sección 4.1, punto 1).
3. **Joel aprueba la lista de permisos de la sección 4** y que el rol de la base no sea `postgres`. Si no la acepta, se pasa a B (≈ +14 a +20 h sobre lo estimado).
4. Corregir el desajuste de `06_grants.sql` antes de usar el esquema en el servidor (sección 4.1, punto 4).

**Riesgos que quedan:** (a) las políticas RLS son `using (true)`, así que toda la autorización de filas depende de `core-api`; (b) el spike no probó carga ni concurrencia; (c) no se probó el camino real a través de `core-api` (llega en CRM-T5): solo se probó el proveedor directo a PostgREST con un token local; (d) Adjuntos y avatar quedan fuera.

## 8. Qué no se hizo

- No se tocó el VPS, n8n, WAHA ni Cloudflare. No se ejecutaron `supabase db reset` ni `db push`. No se instalaron dependencias npm.
- No se probaron los tests `app` (necesitan Chromium).
- Los datos son ficticios. El token y las claves del spike están fuera del repo.