# CLAUDE.md propuesto (borrador, no activo)

> **Antes de copiarlo:**
> - Conservar lo que ya tiene `CLAUDE.md`: la línea `@AGENTS.md` y, si se decide mantenerlo, el bloque del harness. Este texto va al inicio.
> - `.claude/rules/english-only.md` exige inglés en lo versionado. Hay que traducirlo o acordar una excepción.
> - Confirmar lo marcado **POR DECIDIR**. Sale de `docs/auditoria/AUDITORIA_SALVIONIX_CRM_20261102.md`.

---

@AGENTS.md

# CRM Salvionix (BYTOGAM)

Fork de Atomic CRM para Salvionix Biosafety Solutions. Producto a futuro de BYTOGAM para otros clientes: la licencia y la simplicidad importan.

## El negocio

- **Salvionix** es la empresa. **Vital Oxide** es el producto que aplica. No son lo mismo. Se vende el servicio de aplicación, no la botella.
- **Modelo "Uber de tareas":** la publicidad trae al cliente, el bot vende y genera la orden, un técnico de la zona va, aplica, cobra y se va. Hoy: Esteban en Orlando. Meta: muchas ciudades.
- **Javier** es el bot (n8n + Claude). Atiende por WhatsApp (WAHA) y SMS. Si se traba, la venta pasa a una persona.
- **El CRM es la memoria del agente.** Javier encuentra la oportunidad por el teléfono: conversación, datos, cotización, etapa y tareas.
- **Simple ("basicongo").** Los usuarios vienen de Excel. Ante la duda, quitar.

### Reglas de negocio que el código debe respetar

- **Slots:** cada servicio tiene inicio, fin, dirección y técnico, está atado a un lead y **no se cruza**. La regla vive en la base, no solo en la app. Dura 1 h. El bot ofrece solo horarios libres: todo está bloqueado salvo la disponibilidad declarada.
- **Números reasignados:** el teléfono cambia de dueño. Se distingue al dueño anterior, se empieza de cero y **no se pierde el historial**.
- **Leads de prueba:** nombre que empieza con "Prueba" (Prueba Sebas, Prueba Juanma). No cuenta como cliente, no entra a reportes y no bloquea la agenda.
- **Afirmaciones del producto:** Vital Oxide es un pesticida registrado. Solo se afirma lo aprobado. Ningún texto nuevo agrega afirmaciones sanitarias sin OK de JM.
- **Precios:** los calcula `core-api`, no el modelo. **POR DECIDIR:** confirmación de JM del tarifario del prompt.

## Arquitectura aprobada (29/10)

| Pieza | Decisión |
|---|---|
| CRM | Fork de Atomic CRM (MIT) |
| Servicio propio | `core-api` en TypeScript, Node 24, Fastify. Única puerta |
| Base | PostgreSQL 17 propio, separado de la base de n8n, sin puertos publicados |
| n8n | **Sin acceso a la base ni a llaves de canales.** Habla con `core-api` con un token de conversación de 15 min |
| WAHA | Red interna. Firma con HMAC hacia `core-api`. Envíos por outbox con ritmo |
| DNS | salvionix.com en Cloudflare Free. `api` y `crm` por Tunnel con Access. **Web y FTP siguen en Hostinger.** bytogam.com no se toca |
| Login | Cloudflare Access para el equipo. Login propio recién en la fase comercial |

Mensaje: WAHA → `core-api` (firma, dedupe, tarjetas, canal y marca, guardar) → n8n (mensaje + historial + ficha + token) → tools de `core-api` → outbox → cliente.

**Proveedor de datos — POR DECIDIR (spike de 2 h):** dataProvider delgado en carpeta nueva, que habla solo con `core-api`, el cual reenvía a un PostgREST interno con rol limitado. Respaldo: rutas `/admin/*` a medida. Supabase no va a producción. Mientras tanto, `src/components/atomic-crm/providers/supabase/` queda intacto.

**Modelo de datos:** ver la sección 7 de la auditoría. Tablas y columnas en inglés.

**Fuera del MVP:** formulario web, SMS por `core-api`, PDFs, Camila, recompra, login propio.

## Condiciones de Joel (no negociables)

1. **Todo webhook se prueba primero en el número de pruebas de BYTOGAM.** Producción (Javier, Camila, SMS 630) no se toca hasta que funcione.
2. WAHA es multimarca: `core-api` manda cada mensaje al bot correcto. Webhook por sesión, nunca global.
3. Capturas del DNS antes y después. SSL en Full; Full (strict) al confirmar el certificado.
4. Mismo VPS como riesgo aceptado, con redes Docker separadas.

## Seguridad

- **No abrir `.env`, `.env.*`, `.hostinger-ftp` ni `sftp.json`.** Si se encuentra un secreto, indicar archivo y línea, sin copiar el valor.
- **Sin acción sin permiso de Sebastián:** SSH, SFTP o FTP, y operaciones contra n8n, WAHA, Postgres, Hostinger o Cloudflare.
- Secretos en Bitwarden; en el VPS, archivos 600 montados como `secrets` de Compose. Nunca en git, chats ni herramientas de IA.
- Nada de datos reales de clientes en fixtures, logs, prompts o tests.
- **Ninguna tool del bot recibe un id de cliente:** el contacto sale del token.
- Firma verificada sobre el cuerpo crudo y en tiempo constante. Esquema estricto en cada ruta. Ante error: respuesta genérica y ninguna acción.
- Tarjetas redactadas (Luhn) antes de guardar y antes del LLM.
- Toda ruta pública en `ROUTES.md`. Si no está en la lista, no existe.
- SQL solo con parámetros. Ningún servicio usa el rol `postgres`.
- Dependencias: lockfile, `npm ci --ignore-scripts`. `.npmrc` fija `min-release-age`: no saltarlo.
- **Antes de sumar una dependencia o tecnología: revisar licencia y si se puede vender.** n8n tiene licencia de uso interno: no se empaqueta dentro del producto.

## Comandos

```bash
make install        # dependencias
make start          # stack con Supabase local
make start-demo     # FakeRest, sin backend
make test           # vitest
make typecheck      # TypeScript
make lint           # ESLint y Prettier
make build          # producción; escribe en dist/
```

```bash
npx supabase db diff --local -f <nombre>   # generar migración
npx supabase migration up --local          # aplicar
```

- **Nunca** `npx supabase db reset --local` ni `db push` sin pedirlo: borran datos o tocan remoto.
- El checkout de Sebastián usa los puertos 553xx (`supabase/config.toml`), no los 543xx de `AGENTS.md`.
- Node: `.nvmrc` pide v24. En Windows, `INICIAR-CRM.cmd` usa `.tools\`.
- Los tests `app` necesitan Chromium: `make install-playwright-browsers`, solo si Sebastián lo aprueba.
- **POR DECIDIR:** comandos de `core-api` y del entorno Postgres + PostgREST.

## Convenciones

- **Idioma:** código, commits, comentarios y nombres de base en inglés. Con el usuario, y en la interfaz en español, español claro.
- **Alcance:** hacer lo pedido. Lo que se encuentre al paso se reporta, no se corrige en el mismo cambio.
- **Ramas y PR:** con el código de la hoja Pendientes: `f1-b3-core-api-webhooks`. Nada entra a `main` sin un PR revisado por Joel.
- **Repo:** privado. **POR DECIDIR:** URL del remoto. `origin` apunta hoy a marmelab: nunca hacer push ahí.
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
