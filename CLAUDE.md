@AGENTS.md

# CRM Salvionix (BYTOGAM)

Fork de Atomic CRM para Salvionix Biosafety Solutions. Producto a futuro de BYTOGAM para otros clientes: la licencia y la simplicidad importan.

Origen: `docs/auditoria/AUDITORIA_SALVIONIX_CRM_20261102.md` (con las correcciones de Sebastián del 02/11).

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

- Los comandos `make ...` de `AGENTS.md` equivalen a estos scripts de npm. **En Windows no hay `make`**.
- **Nunca** `npx supabase db reset --local` ni `db push` sin pedirlo: borran datos o tocan remoto.
- El checkout de Sebastián usa los puertos 553xx (`supabase/config.toml`), no los 543xx de `AGENTS.md`.
- Node: `.nvmrc` pide v24. En Windows, `INICIAR-CRM.cmd` usa `.tools\`.
- El hook pre-commit (`.husky/pre-commit`) llama a `make registry-gen`. En Windows falla con "make: command not found", y el generador (`scripts/generate-registry.mjs`) vacía la lista de archivos de `registry.json`. No commitear ese cambio de `registry.json`; regenerar el registro solo desde Linux/WSL.
- Los tests `app` necesitan Chromium: `make install-playwright-browsers`, solo si Sebastián lo aprueba.
- **POR DECIDIR:** comandos de `core-api` y del entorno Postgres + PostgREST.

## Convenciones

- **Idioma:** en **inglés** el código, los nombres de base de datos, los comentarios y los commits. En **español** `docs/` y este `CLAUDE.md`, y la interfaz. Con el usuario, español claro. Ver `.claude/rules/english-only.md`.
- **Alcance:** hacer lo pedido. Lo que se encuentre al paso se reporta, no se corrige en el mismo cambio.
- **Ramas y PR:** con el ID de tarea de la hoja de Pendientes: `crm-t0-rescate`, `crm-t1-spike-postgrest`, `crm-t5-core-api-webhooks`. Tareas `CRM-T0` … `CRM-T13`. Nada entra a `main` sin un PR revisado por Joel.
- **Remotos:** `origin` es el repo privado de BYTOGAM. `upstream` es marmelab, con el push desactivado (`DISABLED`): **nunca** hacer push a marmelab. Para traer cambios: `git fetch upstream` y merge de `upstream/main`.
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

## Harness del upstream: apagado

El bloque "Agent Workflow" de abajo viene del upstream y se conserva para poder hacer merge sin conflictos. **No se usa** salvo que Sebastián escriba `#harness` de forma explícita.

# Agent Workflow

Code-change requests can run through the **agent harness**: subagents (planner, developer, quality-reviewer, merger, documentator) implementing the change via a deterministic foreground pipeline in git worktrees. **Opt-in, off by default;** otherwise the main thread implements the change itself.

**Dispatch rule (top-level session only).** Only on an opt-in (see "Opting in") does the top-level session dispatch the `orchestrator` and relay its result; never route or implement it yourself then. Pass your `<session_dir>` in the prompt (it namespaces worktrees/branches). A subagent NEVER dispatches an orchestrator (`block-nested-orchestrator` enforces it). The orchestrator owns all routing (SIMPLE/COMPLEX, plus SETUP/MEMORY/ROLLBACK-CONFLICT/RECOVERY, dispatch templates, waves, promotion, migration round) and drives the team to a terminal point. Each agent's last line is an output contract (`.claude/rules/agent-output-format.md`).

**"Launched" is NOT "done".** The dispatch is meant to block, but some runtimes (interactive Claude Code / the VS Code extension) return immediately with `Async agent launched … agentId: <id>` and deliver the result later as a `task-notification`. That ack means dispatched, not finished: do NOT fill the silence by implementing the feature yourself or re-dispatching (that duplicates the developer's work). While it runs, only surface progress, then relay the final report. On completion, before relaying, check `<session_dir>/needs-recovery` (written by `completion-invariant` when the orchestrator stopped with APPROVED-but-unmerged work): if present, dispatch a FRESH `orchestrator` with `<intent>recovery</intent>` and the same `<session_dir>` (never `SendMessage` the old one), wait, then relay.

**Resuming after a restart.** Closing the VS Code window / editor (or rebooting) between two harness steps kills the orchestrator's background process, but Claude Code reuses the SAME session id when you reopen the conversation, so the harness namespace (`<session_dir>`, `session/<short>` branch, worktrees) is unchanged. The gate pauses (plan gate, migration gate) are the exposed windows: the orchestrator has ended its turn and this thread is idle awaiting you, so a `task-notification` for the old (now dead) process will never arrive. Two things make resume work: (1) `cleanup-session` no longer deletes an in-flight session's state on a clean close, and (2) the `session-bootstrap` SessionStart hook detects in-flight state for the current session and injects a `<harness_resume>` banner naming the phase. When you see that banner (or the user asks to continue an interrupted harness), dispatch a FRESH `orchestrator` with `<intent>recovery</intent>` and the same `<session_dir>` (from the banner / the earlier turns), wait, then relay. NEVER `SendMessage` the previous orchestrator (it is dead) and never re-implement the work yourself. This is keyed on the current session id only, so a second concurrent window (its own session id) is never offered another session's work.

**PD-ASK round-trip (migration confirmation).** The orchestrator may end its turn asking *"apply the database migration now?"* (it does not under `gate=none`, which auto-applies; see "Gate level"). Relay it to the user; do NOT `SendMessage` the old orchestrator to relay the answer (relayed approvals carry no user authority, so it loops re-asking). On the reply:
- **Approved**: FIRST write `<session_dir>/migration-approval.json` = `{"kind":"migration-approval","session_id":"<id>","question":"<asked>","answer":"<user's verbatim reply>","approved_at":"<ISO-8601>","via":"AskUserQuestion"}` (the durable audit trail). THEN dispatch a FRESH `orchestrator` whose prompt begins `<intent>apply-migration</intent>`, states the approval, references that record, and passes the same `<session_dir>`. The built-in security warning on a relayed approval is expected.
- **Wants changes**: dispatch a fresh `orchestrator` with the new request.

While a fresh dispatch runs, don't start a parallel plan B; wait, then relay.

**Gate level.** A request may carry `gate=none|migration|plan|waves` (default **`plan`**); ALWAYS pass an explicit `GATE: <level>` line (the orchestrator also fails closed to `plan` on a missing/unknown value). There are two independent pause points: the **plan gate** (after planning) and the **migration gate** (before applying the deploy-time migration).
- `none`: fully autonomous. No plan pause, and it applies the migration itself with no confirmation.
- `migration`: pauses after planning for ticket review, and stops to confirm before the migration (same stops as `plan`; a named alias that states the migration stop explicitly).
- `plan` (default): pauses after planning for ticket review, and stops at the migration.
- `waves`: pauses after planning, after each wave, and at the migration.

On the web-chat surface (CRM Builder, `<mode>` tag present) the "save to your data?" confirmation is surface-owned and always shown regardless of gate; `none` auto-apply is a developer-surface behavior. On a plan pause, so the user reviews the REAL tickets (not just your prose summary) on ANY surface (desktop app, CLI, editor), **read the ticket JSONs from `<session_dir>/tickets/` and present each ticket's key fields inline** in the chat: id, title, `acceptance_criteria`, `files_to_modify`, `dependencies`. This inline rendering is the part that must ALWAYS be present (it does not depend on any editor layout). Additionally, offer an openable reference when you can: if a `.harness-session` symlink exists at the workspace root (the `link-session-workspace` hook maintains it in a VS Code multi-root workspace), link `[tickets](.harness-session/tickets/)`; otherwise just give the absolute `<session_dir>/tickets/` path. On approval dispatch a FRESH `orchestrator` with `<intent>execute-plan</intent>` and the same `<session_dir>` (never `SendMessage`); on "wants changes" dispatch a fresh one. CRM Builder's launcher sets `gate=none`.

## Opting in

Off by default. `#harness` (or "use the agent team" / "with the harness") routes through the orchestrator; "harness for this session" keeps it on all session.

**Grill vague requests first.** For a vague or broad `#harness` request, run `Skill({skill: "grill-me"})` in the main thread BEFORE dispatching (the planner never questions; `gate=plan` only reacts after a plan). Fold the answers into the dispatch prompt. Skip when the request is already precise.

`#technical-harness` is the same opt-in for a real developer: it appends a `PERSONA: technical` line (see `orchestrator.md` -> "`PERSONA: technical`"), which (1) uses the full technical register (file paths, `TASK-XXX`, git terms, `database`/`migration`/`Supabase`), (2) reports the mechanical truth (per-ticket status, branches, SHAs, verdicts, ADR paths), (3) stops at `session/<id>` (no promotion, no migration round; you promote and migrate yourself), and (4) appends every step to `<session_dir>/harness-progress.log`.

**Live progress (technical runs).** The report lands only at the end (possibly as a `task-notification`), so surface a live view WITHOUT flooding the chat with a raw log tail. The `render-status` SubagentStop hook renders `.harness/<SESSION_SHORT_ID>/{STATUS.md,TICKETS.md,status.json,session.diff}` (gitignored, per-session, cleaned at SessionEnd) from the live session state after every agent stop. **It does not exist until the first agent stops**, so during initial planning there is no board yet: do NOT present its path at dispatch (a link then is dead: "Couldn't read this file"). Relay it only from the plan-gate pause onward, once the files exist; at dispatch, just say the board will be available once planning completes. `STATUS.md` lists tickets (status + review verdict), live worktrees, a changed-files summary, and recent activity, updating itself as agents finish; `TICKETS.md` is the readable plan; `session.diff` is the actual code the harness changed (the extension does not surface the `/tmp` worktree diffs, so this file is how the user reads them). **Give a path that resolves in the user's client - always the ABSOLUTE path.** The board lives at `<repo>/.harness/<SESSION_SHORT_ID>/`. A bare relative `.harness/...` fails with "outside the working directory" on both the desktop app and a multi-root VS Code workspace, because the client resolves it from the workspace root, not the repo subfolder. So ALWAYS give the absolute path (`<repo>/.harness/<SESSION_SHORT_ID>/STATUS.md`): the desktop app's file pane opens arbitrary absolute paths, and it is the universal fallback. Markdown relative links to `.harness/...` (and to the `.harness-session/` symlink) are unreliable in the VS Code extension - observed: clicking does nothing - so do NOT rely on them. Give the ABSOLUTE path (the desktop file pane opens it, and it copy-pastes cleanly everywhere), and to put openable ticket CONTENT in the chat, `Read` the JSON: a `Read` renders a clickable file card that actually opens, which the plan-gate inline render already does. An opt-in compact statusline is available (`.claude/scripts/harness-statusline.mjs`; wire it in your own `settings.local.json`, see its header) - not committed, since it would override a personal statusline. It is **CLI-only** (the terminal statusline); it does NOT render in the VS Code extension or the desktop app, so on those surfaces use the board or the Monitor feed below. Dispatch the orchestrator with `run_in_background: true`. Prefer the board; for a live in-chat feed on ANY surface (extension / desktop / CLI), a `Monitor({command: "tail -n +1 -F <session_dir>/harness-progress.log", ...})` streams each NEW log line as a chat notification the moment it is written - now including the `[validate:TASK-XXX] typecheck…` / `… checks passed` step lines the `validate-on-stop` hook appends, so the minutes-long silent stretches between milestones (a developer's typecheck / lint / vitest / e2e) are visible instead of going dark. It is a line feed, not a rendered board, and is auto-rate-limited if the log is too chatty, so keep the log at milestone/step granularity. The authoritative end signal is the `task-notification`, not the log: on it, `TaskStop` any monitor, relay the report, and run `/harness-diff` on the session branch it stopped on.

## Agents

orchestrator (routes the harness, dispatched by the main thread), planner, developer, quality-reviewer, merger, documentator. Models: **planner** and **quality-reviewer** on opus, the rest on sonnet/haiku (see each `.claude/agents/*.md`). The web-chat variant is this orchestrator with a non-technical persona injected via `--append-system-prompt` (CRM Builder).

The **developer** is one agent, no modes: it implements a `TICKET_FILE` (COMPLEX wave, peer-reviewed, ADRs for structural decisions, never SQL during tickets) or an inline `CHANGE_REQUEST` (SIMPLE, on the shared `<base>/simple` worktree; refuses `FAILED: out of scope, needs COMPLEX flow` if it needs a breakdown). Two session ops reach it as dispatch-loaded skills on `<base>/simple`: `writing-migrations` and `resolving-rollback-conflicts`. It applies the **Ponytail** ladder (full mode) on every change (baked into `developer.md`; the quality-reviewer enforces it on the diff). Ponytail is also in-repo as `.claude/skills/ponytail*` / `/ponytail*` for interactive use (these do not affect the dev agents). An optional `test-writer` runs only when a ticket sets `separate_test_writer: true`.

## Rules & hooks

Mechanics live in `.claude/rules/` (worktree-scope, agent-output-format, validation-commands, lsp-usage, security-triggers, launcher-interface). Project facts (validation steps, roles, deploy adapter, app smoke, launcher extension points) live in `harness.config.json`. Hooks in `.claude/settings.json` / `.claude/hooks/` are `.mjs` ES modules.
