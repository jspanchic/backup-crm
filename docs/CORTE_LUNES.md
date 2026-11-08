# Corte de WhatsApp Salvionix · lunes 09/11

La sesión `salvionix` usa WAHA GOWS 2026.9.2 con el chip real. El flujo será `WAHA → core-api → copia de Javier en n8n → outbox de core-api → WAHA`. `core-api` coordina el visto, la escritura y el envío. El equipo atiende las tareas de escalación y consulta las órdenes de trabajo en el panel. Javier v4 queda activo durante el corte y listo para recibir de nuevo el webhook.

## a. Desplegar con el envío apagado

- [ ] Confirmar con Joel el acceso, la arquitectura, la capacidad y la red Docker compartida por WAHA y n8n. Usar las verificaciones de la [guía del VPS](DESPLIEGUE_VPS_PRUEBAS.md#a-verificaciones-previas-en-el-vps-solo-lectura). En el VPS se necesita Bash, `jq`, `timeout` y Docker Compose 2.24.4 o posterior para aplicar el archivo de producción. [Referencia de Docker Compose](https://docs.docker.com/reference/compose-file/merge/#replace-value).
- [ ] Preparar el webhook activo de la copia de Javier en `/webhook/<ruta-de-la-copia>`. En producción, las herramientas usan `http://salvionix-core-api-production:8080`. Configurar `horarios_libres`, `reservar` y `confirmar` para habilitarlas en i. `horarios_libres` recibe el ZIP del servicio. Con la agenda apagada, las tres devuelven `409 agenda_apagada` y Javier debe ofrecer atención manual. Usar `responder` con el token de conversación y el texto. `core-api` conserva `session` y `chatId`. Desactivar en la copia los nodos que llaman directamente a WAHA o aplican sus esperas. Una nota de voz o un archivo sin texto llega como aviso de texto. Si `cotizar` devuelve `impuesto_pct=0`, omitir el renglón de impuesto en el mensaje al cliente. Verificar que la copia rechaza una firma inválida antes de ejecutar las herramientas. [Guía de pruebas](DESPLIEGUE_VPS_PRUEBAS.md#d-conexión-con-n8n).

En el PC, desde la raíz del repo, construir para la arquitectura que devuelve `uname -m` en el VPS. Para `aarch64`, poner `linux/arm64` en `$plataforma`.

```powershell
$plataforma = 'linux/amd64'
$vps = Read-Host 'Usuario y host SSH del VPS (usuario@host)'
docker build --platform $plataforma -f infra/vps/core-api.Dockerfile -t salvionix-crm/core-api:production -t salvionix-crm/core-api:test .
docker build --platform $plataforma -f infra/vps/panel.Dockerfile -t salvionix-crm/panel:test .
docker build --platform $plataforma --build-arg PANEL_PRESENTATION_MODE=false -f infra/vps/panel.Dockerfile -t salvionix-crm/panel:production .
docker save -o salvionix-imagenes.tar salvionix-crm/core-api:production salvionix-crm/core-api:test salvionix-crm/panel:production salvionix-crm/panel:test
ssh $vps 'mkdir -p ~/salvionix-crm-production ~/salvionix-crm'
scp salvionix-imagenes.tar "${vps}:~/"
scp infra/vps/docker-compose.yml infra/vps/docker-compose.production.yml infra/vps/gateway.nginx.template infra/vps/configure-production.sql infra/vps/precios-salvionix.json infra/vps/aplicadores.example.json infra/vps/.env.example "${vps}:~/salvionix-crm-production/"
scp infra/vps/docker-compose.yml infra/vps/gateway.nginx.template infra/vps/.env.example infra/vps/send-test-message.mjs infra/vps/clean-test-data.sql "${vps}:~/salvionix-crm/"
```

En el VPS, preparar el directorio de producción. Mantener `salvionix-crm` como proyecto de pruebas separado.

```bash
docker load -i ~/salvionix-imagenes.tar
cd ~/salvionix-crm-production
umask 077
test -e .env || install -m 600 .env.example .env
chmod 600 .env
```

- [ ] En el `.env` de **este directorio**, configurar `N8N_DOCKER_NETWORK`, `N8N_UPSTREAM` y `BOT_URL_JAVIER`. Para el último, usar la ruta activa de la copia vía `http://gateway:8081/webhook/<ruta-de-la-copia>`. Configurar las cuatro contraseñas de Postgres, `PGRST_JWT_SECRET`, `CONVERSATION_TOKEN_SECRET`, `BOT_HMAC_SECRET` y `WAHA_HMAC_SALVIONIX`. Provisionar el mismo `BOT_HMAC_SECRET` en la copia de n8n y el mismo `WAHA_HMAC_SALVIONIX` en el webhook de WAHA, con al menos 16 caracteres para el HMAC de WAHA. Manejar las claves en Bitwarden y el VPS.
- [ ] Mantener apagado el envío durante el despliegue. El siguiente comando fuerza ese estado aunque la terminal tenga variables de otra prueba.

```bash
crm=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml --profile panel)
sql() { "${crm[@]}" exec -T db psql -X -U core_owner -d salvionix -v ON_ERROR_STOP=1 "$@"; }
export WAHA_SEND_ENABLED=false PANEL_LOOPBACK_ADMIN=false
"${crm[@]}" config -q &&
  "${crm[@]}" stop core-api &&
  "${crm[@]}" up -d --no-build --wait --wait-timeout 120 db migrate postgrest core-api gateway panel &&
  "${crm[@]}" up -d --no-build --no-deps --force-recreate --wait gateway
"${crm[@]}" ps -a
"${crm[@]}" logs --tail=25 migrate
sql < configure-production.sql
"${crm[@]}" exec -T core-api node -e 'process.exit(process.env.BOT_URL_JAVIER?.startsWith("http://gateway:8081/webhook/") && process.env.WAHA_SEND_ENABLED === "false" ? 0 : 1)'
```

- [ ] Cargar `precios-salvionix.json`, versión 2. El archivo incorpora los factores de metraje de Javier v4 con `area_factors_provisional=false`. Continuar si el importador confirma `6 controls passed`. El caso de 1.731 pies² cubiertos da USD 208 de subtotal, 15 de descuento y 193 de total. Los controles también cubren el hogar con garaje y áreas adicionales, los redondeos a 1.501 y 1.546 pies², el caso de 8.000 pies² cubiertos más 3.000 descubiertos y el mínimo de USD 150. [Datos reales](DATOS_REALES.md).

```bash
"${crm[@]}" run --rm --no-deps -T migrate node scripts/db-import-pricing.ts - < precios-salvionix.json
```

- [ ] Validar la base y la puerta interna. El despliegue detiene el worker anterior antes de migrar y recrea el gateway para cargar la lista nueva de rutas. En una instalación nueva, esperar impuesto 0, bot, agenda y `pdf_clientes_reales` en `f`, un canal `salvionix` real y activo, y cero técnicos, contactos y mensajes en cola. Confirmar que se aplicaron las migraciones de ritmo, PDF, disponibilidad, escalación y panel. Los valores iniciales del canal son 2000 ms antes del visto, 2000 ms antes de indicar escritura, 2000 ms antes de enviar y 6 envíos por minuto. [Configuración por canal](DESPLIEGUE_VPS_PRUEBAS.md#d8-ritmo-de-waha-por-canal), [envío de PDF](DATOS_REALES.md#5-envío-de-pdf-a-clientes-reales).

```bash
sql <<'SQL'
SELECT slug, tax_pct, bot_enabled, bot_agenda_enabled, pdf_clientes_reales FROM core.brands WHERE slug = 'salvionix';
SELECT waha_before_seen_ms, waha_before_typing_ms, waha_before_send_ms, waha_messages_per_minute
FROM core.channels WHERE provider = 'waha' AND identifier = 'salvionix';
SELECT provider, identifier, bot_key, is_test, active FROM core.channels;
SELECT count(*) AS technicians FROM core.technicians;
SELECT count(*) AS contacts FROM public.contacts;
SELECT count(*) AS queued FROM core.outbox WHERE status IN ('pending', 'sending');
SELECT count(*) AS uncertain FROM core.outbox WHERE starts_with(last_error, 'delivery_uncertain');
SELECT filename FROM core.schema_migrations WHERE filename IN ('0022_waha_outbox_pacing.sql', '0023_real_pdf_delivery.sql',
  '0024_production_availability.sql', '0025_escalation_task.sql', '0026_production_agenda_panel.sql') ORDER BY filename;
SQL
"${crm[@]}" exec -T gateway wget -qO- http://127.0.0.1:8080/healthz
read -r -p 'Contenedor de n8n: ' N8N_CONTAINER
docker exec "$N8N_CONTAINER" wget -qO- http://salvionix-core-api-production:8080/healthz
docker exec "$N8N_CONTAINER" wget -S -O /dev/null http://salvionix-core-api-production:8080/admin/session
# healthz = {"status":"ok"}. /admin/session = 403.
```

### Panel de operador en producción

- [ ] Mantener el panel publicado únicamente en `127.0.0.1:8089` del VPS. En el primer arranque, con `PANEL_LOOPBACK_ADMIN` desactivado, comprobar desde el propio VPS que el panel responde y `/admin/session` devuelve `404`.

```bash
curl -fsS -o /dev/null http://127.0.0.1:8089/
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8089/admin/session)" = 404
```

- [ ] Usar el correo de un operador autorizado por Joel. El SQL obtiene el UUID de un operador activo y, en una base nueva, permite crear su identidad local de operador. La cuenta nueva queda sin privilegios de administrador. El acceso al panel se concede mediante SSH.

```bash
read -r -p 'Correo del operador autorizado: ' operator_email
if [ -n "$operator_email" ] && operator_sub=$(sql -qAt -v operator_email="$operator_email" <<'SQL'
BEGIN;
CREATE TEMP TABLE new_panel_user (id uuid) ON COMMIT DROP;
WITH created AS (
  INSERT INTO auth.users (email, raw_user_meta_data, is_sso_user)
  VALUES (:'operator_email', '{"first_name":"Operador","last_name":"Salvionix"}', true)
  ON CONFLICT (email) DO NOTHING
  RETURNING id
)
INSERT INTO new_panel_user SELECT id FROM created;
UPDATE public.sales SET administrator = false WHERE user_id IN (SELECT id FROM new_panel_user);
SELECT s.user_id
FROM public.sales s JOIN auth.users u ON u.id = s.user_id
WHERE u.email = :'operator_email' AND NOT s.disabled;
COMMIT;
SQL
) && [[ "$operator_sub" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] &&
   sed -i -e '/^PANEL_LOOPBACK_ADMIN=/d' -e '/^ADMIN_DEV_SUB=/d' .env &&
   printf '%s\n' 'PANEL_LOOPBACK_ADMIN=true' "ADMIN_DEV_SUB=$operator_sub" >> .env; then
  unset PANEL_LOOPBACK_ADMIN ADMIN_DEV_SUB
  "${crm[@]}" config -q &&
    "${crm[@]}" up -d --no-build --wait --wait-timeout 120 core-api panel gateway &&
    test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8089/admin/session)" = 200 &&
    docker exec "$N8N_CONTAINER" node -e 'fetch("http://salvionix-core-api-production:8080/admin/session").then(r => process.exit(r.status === 403 ? 0 : 1), () => process.exit(1))'
else
  printf '%s\n' 'Revisa la identidad del operador antes de habilitar el panel.' >&2
fi
unset operator_email operator_sub
```

- [ ] Abrir el túnel desde el PC, en otra terminal, y visitar `http://127.0.0.1:18089/`. Si se configuró otro `PRODUCTION_PANEL_PORT` en el VPS, ajustar el puerto remoto del túnel y las comprobaciones HTTP anteriores. Confirmar que el panel permite editar disponibilidad, registrar o retirar ausencias y bloqueos, y liberar un apartado vigente. El resto queda en modo de solo lectura.

```powershell
$vps = Read-Host 'Usuario y host SSH del VPS (usuario@host)'
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18089:127.0.0.1:8089 $vps
```

## b. Probar en la pila aislada

- [ ] Usar el proyecto `salvionix-crm` de la [guía de pruebas](DESPLIEGUE_VPS_PRUEBAS.md). Preparar su configuración privada según b.4 y d.5 de la guía. Usar el `core-api:test` recién construido y una copia de ensayo de Javier con la misma lógica, HMAC de ensayo y herramientas en `http://salvionix-core-api:8080`.

```bash
cd ~/salvionix-crm
export WAHA_SEND_ENABLED=false WAHA_BASE_URL=http://waha.invalid:3000 WAHA_UPSTREAM=waha.invalid:3000
docker compose config -q && docker compose stop core-api &&
  docker compose up -d --no-build --wait --wait-timeout 120 &&
  docker compose up -d --no-build --no-deps --force-recreate --wait gateway &&
  test "$(docker inspect --format '{{.Image}}' "$(docker compose ps -q core-api)")" = \
    "$(docker image inspect --format '{{.Id}}' salvionix-crm/core-api:test)" &&
  docker compose run --rm --no-deps migrate node scripts/db-seed.ts &&
  docker compose exec -T core-api node --input-type=module - 14075550150 \
    'Hola, quiero cotizar 8000 pies cubiertos y 3000 descubiertos' < send-test-message.mjs
docker compose logs --tail=50 core-api
```

- [ ] Esperar `core-api answered 200`. Verificar que la copia de ensayo ejecuta las herramientas y que `responder` deja una respuesta en la conversación de prueba. El código 200 solo confirma la recepción. El valor USD 1.060 se valida con el importador en a.
- [ ] Desde `core-api` en el PC, con la base local de pruebas disponible, ejecutar `npm test`. Verificar con WAHA simulado la secuencia de entrada, espera → `sendSeen` → espera → `startTyping` → n8n, y la de salida, espera → `sendText` → `stopTyping`. Las pruebas comprueban además el orden dentro de un chat, el límite global y la recuperación sin duplicar un envío.
- [ ] Ensayar con el chip de pruebas de BYTOGAM y autorización de Joel. Introducir `WAHA_CONTAINER` y `WAHA_PORT` como en c. Preparar el directorio privado y las funciones `waha` y `wait_working` de d. Usar solo la sesión `bytogam-pruebas` en este ensayo.

```bash
waha bytogam-pruebas GET | jq -e 'select(.status == "WORKING" and (.config | type == "object")) | {name, config}' > "$CUT_DIR/bytogam-antes.json"
read -rs -p 'HMAC de BYTOGAM: ' test_hmac; printf '\n'
printf '%s' "$test_hmac" > "$CUT_DIR/bytogam-hmac"
unset test_hmac
jq -e --rawfile key "$CUT_DIR/bytogam-hmac" '
  select(($key | length) >= 16) | .config.webhooks = [
    {url: "http://salvionix-core-api:8080/hooks/whatsapp", events: ["message"], hmac: {key: $key}}
  ]' "$CUT_DIR/bytogam-antes.json" > "$CUT_DIR/bytogam-ensayo.json"
test -s "$CUT_DIR/bytogam-ensayo.json" && waha bytogam-pruebas PUT "$CUT_DIR/bytogam-ensayo.json" &&
  wait_working bytogam-pruebas 20 "$CUT_DIR/bytogam-ensayo.json"
```

- [ ] Confirmar que un mensaje real de BYTOGAM se despacha a la copia de ensayo. Para ensayar también la salida, habilitarla solo en la pila aislada con la cola vacía y una entrada real de BYTOGAM. Apagarla al terminar el ensayo. Restaurar la configuración de BYTOGAM y medir la vuelta a `WORKING`. Si el ensayo de restauración falla o demora un minuto o más, aplazar el corte. [Ensayo real aislado](DESPLIEGUE_VPS_PRUEBAS.md#d7-una-prueba-controlada-con-waha-real-solo-si-se-acuerda).

```bash
time (test -s "$CUT_DIR/bytogam-antes.json" && waha bytogam-pruebas PUT "$CUT_DIR/bytogam-antes.json" &&
  wait_working bytogam-pruebas 20 "$CUT_DIR/bytogam-antes.json")
```

### Si no existe la sesión de BYTOGAM

- [ ] Acordar con Joel un momento sin tráfico de `salvionix` mientras la sesión sigue conectada a v4. Preparar las funciones y guardar `v4.json` según d antes de crear o aplicar `corte.json`. Confirmar que la configuración actual coincide con la guardada y hacer un `PUT` con el mismo archivo, sin editarlo. Registrar cuánto tarda la sesión en volver a `WORKING`. Este ensayo mide la recuperación de la sesión. La verificación del flujo con mensajes corresponde a e.

```bash
if test -s "$CUT_DIR/v4.json" && waha salvionix GET | jq -e --slurpfile saved "$CUT_DIR/v4.json" '
  .name == "salvionix" and .status == "WORKING" and ({name, config} == $saved[0])
' >/dev/null; then
  time (waha salvionix PUT "$CUT_DIR/v4.json" && wait_working salvionix 20 "$CUT_DIR/v4.json")
else
  printf '%s\n' 'No ensayes hasta verificar que la sesión sigue en v4 y coincide con la configuración guardada.' >&2
fi
```

- [ ] Si la sesión falla al volver a `WORKING` o tarda un minuto o más, aplazar el corte.

## c. Habilitar la salida a WAHA

- [ ] Volver a `~/salvionix-crm-production`. Verificar que la cola de producción está vacía, que hay cero entregas inciertas y que el bot sigue apagado. Confirmar que los nodos de envío directo están deshabilitados en la copia de Javier. Verificar que el contenedor corresponde a `devlikeapro/waha:gows-2026.9.2`. Su Swagger define `messageIds` para el visto del mensaje entrante y `session` y `chatId` para el indicador de escritura. [Imagen oficial de WAHA](https://hub.docker.com/r/devlikeapro/waha/tags), [contrato de WAHA 2026.9.2](https://github.com/devlikeapro/waha/blob/2026.9.2/src/structures/chatting.dto.ts#L81-L107).
- [ ] Configurar de forma persistente en el `.env` **de producción** `WAHA_SEND_ENABLED`, `WAHA_UPSTREAM`, `WAHA_BASE_URL` y `WAHA_API_KEY`. La clave se toma de Bitwarden si WAHA la requiere. Para las otras tres variables, usar los comandos siguientes con el nombre y puerto interno verificados de WAHA. En WAHA y n8n se conserva la red compartida de a.

```bash
cd ~/salvionix-crm-production
read -r -p 'Contenedor de WAHA: ' WAHA_CONTAINER
read -r -p 'Puerto interno de WAHA: ' WAHA_PORT
if [[ "$WAHA_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ && "$WAHA_PORT" =~ ^[0-9]+$ ]] &&
   [ "$(docker inspect --format '{{.Config.Image}}' "$WAHA_CONTAINER")" = devlikeapro/waha:gows-2026.9.2 ] &&
   sed -i -e '/^WAHA_SEND_ENABLED=/d' -e '/^WAHA_BASE_URL=/d' -e '/^WAHA_UPSTREAM=/d' .env &&
   printf '%s\n' 'WAHA_SEND_ENABLED=true' 'WAHA_BASE_URL=http://gateway:8082' \
     "WAHA_UPSTREAM=$WAHA_CONTAINER:$WAHA_PORT" >> .env; then
  unset WAHA_SEND_ENABLED WAHA_BASE_URL WAHA_UPSTREAM
  "${crm[@]}" config -q &&
    "${crm[@]}" up -d --no-build --wait --wait-timeout 120 core-api gateway &&
    "${crm[@]}" exec -T core-api node -e 'process.exit(process.env.WAHA_SEND_ENABLED === "true" ? 0 : 1)' &&
    echo 'Envío habilitado'
  sql -c "SELECT count(*) AS queued FROM core.outbox WHERE status IN ('pending', 'sending');"
  sql -c "SELECT count(*) AS uncertain FROM core.outbox WHERE starts_with(last_error, 'delivery_uncertain');"
else
  printf '%s\n' 'Detén el corte y revisa la configuración y la imagen de WAHA.' >&2
fi
```

## d. Cambiar solo el webhook de `salvionix`

- [ ] Confirmar en Swagger de la versión instalada que la sesión usa `GET` y `PUT /api/sessions/{session}`. El `PUT` repone la configuración completa y reinicia la sesión que está en marcha. Acordar con Joel la ventana y revisar si existe algún webhook global que también ejecute v4. Los webhooks globales no aparecen en la configuración de la sesión. [Sesiones de WAHA](https://waha.devlike.pro/docs/how-to/sessions/#update-session), [webhooks de WAHA](https://waha.devlike.pro/docs/how-to/events/#global-webhooks).

Preparar la restauración antes del cambio. El comando usa la API desde el propio contenedor WAHA por loopback. Los archivos de recuperación pueden incluir credenciales y se guardan fuera del repo con permisos privados. Tener esta terminal abierta durante el corte.

```bash
set +x
set -o pipefail
umask 077
CUT_DIR=$(mktemp -d "$HOME/.salvionix-corte.XXXXXX")
read -rs -p 'Clave API de WAHA (Enter si no usa): ' waha_key; printf '\n'
printf '%s\n' "$waha_key" > "$CUT_DIR/api-key"
unset waha_key

waha() {
  { cat "$CUT_DIR/api-key"; if [ "$#" -eq 3 ]; then cat "$3"; fi; } |
    docker exec -i "$WAHA_CONTAINER" node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const [session, method, port] = process.argv.slice(1);
      const input = readFileSync(0, "utf8");
      const separator = input.indexOf("\n");
      const key = input.slice(0, separator);
      const res = await fetch(`http://127.0.0.1:${port}/api/sessions/${encodeURIComponent(session)}`, {
        method, redirect: "error", signal: AbortSignal.timeout(method === "PUT" ? 25000 : 4000),
        headers: { Accept: "application/json", ...(key && { "X-Api-Key": key }),
          ...(method === "PUT" && { "Content-Type": "application/json" }) },
        body: method === "PUT" ? input.slice(separator + 1) : undefined,
      });
      if (!res.ok) { console.error(`WAHA HTTP ${res.status}`); process.exit(1); }
      if (method === "GET") process.stdout.write(await res.text());
    ' "$1" "$2" "$WAHA_PORT"
}

wait_working() {
  local deadline=$((SECONDS + $2))
  while (( SECONDS < deadline )); do
    if waha "$1" GET | jq -er --slurpfile wanted "$3" '
      select(.status == "WORKING" and
        ([.config.webhooks[]?.url] == [$wanted[0].config.webhooks[]?.url])) | .status'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

docker exec "$WAHA_CONTAINER" node -e 'process.exit(process.env.WHATSAPP_HOOK_URL ? 1 : 0)' && echo 'Sin webhook global'
docker exec "$WAHA_CONTAINER" node -e 'fetch("http://salvionix-core-api-production:8080/healthz").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))' && echo 'WAHA alcanza el gateway'
waha salvionix GET | jq -e 'select(.name == "salvionix" and .status == "WORKING" and (.config.webhooks | type == "array")) | {name, config}' > "$CUT_DIR/v4.json"
```

- [ ] Confirmar en privado que `v4.json` tiene la configuración completa de la sesión y que WAHA devolvió los campos necesarios para restaurarla. Si la ruta de v4 solo aparece como global, si falta configuración para restaurar, o si WAHA no llega al gateway, detener el corte.
- [ ] Crear la petición de cambio conservando todos los webhooks ajenos al de v4. La URL anterior se introduce tal como figura en la configuración de la sesión, sin mostrarla. El HMAC es `WAHA_HMAC_SALVIONIX`. [Firma y cabeceras de WAHA](https://waha.devlike.pro/docs/how-to/events/#hmac-authentication).

```bash
read -rs -p 'URL exacta del webhook de Javier v4: ' v4_url; printf '\n'
printf '%s' "$v4_url" > "$CUT_DIR/v4-url"
unset v4_url
read -rs -p 'HMAC de entrada de Salvionix: ' waha_hmac; printf '\n'
printf '%s' "$waha_hmac" > "$CUT_DIR/hmac"
unset waha_hmac

jq -e --rawfile old "$CUT_DIR/v4-url" --rawfile key "$CUT_DIR/hmac" \
  --arg new 'http://salvionix-core-api-production:8080/hooks/whatsapp' '
  select(($old | length) > 0 and ($key | length) >= 16 and $old != $new) |
  select(([.config.webhooks[] | select(.url == $old)] | length) == 1) |
  select(all(.config.webhooks[]; .url != $new)) |
  .config.webhooks |= map(if .url == $old then
    {url: $new, events: ["message"], hmac: {key: $key}}
  else . end)' "$CUT_DIR/v4.json" > "$CUT_DIR/corte.json"
```

- [ ] Una vez revisadas ambas peticiones, habilitar el bot y aplicar el cambio. La actualización exige una lista vigente aprobada, impuesto 0, cola vacía y cero entregas inciertas. Si el cambio o la comprobación falla, ejecutar f.

```bash
enable_salvionix_bot() {
  local changed
  changed=$(sql -qAt <<'SQL'
UPDATE core.brands b SET bot_enabled = true
WHERE b.slug = 'salvionix' AND NOT b.bot_enabled
  AND b.tax_pct = 0 AND b.discount_enabled
  AND EXISTS (SELECT 1 FROM core.price_lists p
              WHERE p.id = core.active_price_list(b.id) AND p.is_confirmed AND p.currency = 'USD')
  AND NOT EXISTS (SELECT 1 FROM core.outbox WHERE status IN ('pending', 'sending')
                  OR starts_with(last_error, 'delivery_uncertain'))
RETURNING b.slug;
SQL
  ) && [ "$changed" = salvionix ]
}

test -s "$CUT_DIR/v4.json" && test -s "$CUT_DIR/corte.json" && enable_salvionix_bot &&
  waha salvionix PUT "$CUT_DIR/corte.json" &&
  wait_working salvionix 20 "$CUT_DIR/corte.json"
```

## e. Verificar con 2–3 mensajes reales del equipo

- [ ] Pedir al equipo que envíe desde sus propios números 2–3 mensajes directos al chip `salvionix`, uno a la vez. Empezar con un saludo, seguir con el caso de 8.000 pies cubiertos y 3.000 descubiertos y, si hace falta, preguntar por una fecha. En la cotización esperar USD 1.060 y verificar que el mensaje al cliente omite el renglón de impuesto. En la consulta por fecha, esperar la alternativa definida en n8n, sin reserva ni confirmación.
- [ ] Para cada mensaje, comprobar una sola respuesta visible, su ejecución en la copia de Javier y la salida correspondiente en `sent`. Confirmar que v4 no recibe estas entradas y que el equipo recibe el aviso configurado en n8n. Si hay duplicados, respuesta desde v4, precio incorrecto, errores de firma persistentes o no llega respuesta, ejecutar f.
- [ ] Observar el visto y el indicador de escritura antes de la ejecución de n8n. Tras encolar la respuesta, comprobar que llega una sola vez y cesa el indicador. Los logs de la puerta deben mostrar `sendSeen`, `startTyping`, el webhook de n8n, `sendText` y `stopTyping`. Verificar las esperas del canal y el límite global.

## f. Apagar el bot o volver a v4

Interruptor de Salvionix. Toma efecto al confirmar la actualización en la base. `core-api` sigue guardando las entradas, bloquea las herramientas con `409 bot_disabled` y descarta el trabajo pendiente del bot. Una petición a WAHA que ya salió puede terminar. Para reanudar tras revisar la causa, ejecutar `enable_salvionix_bot` y enviar un mensaje nuevo de control. Los mensajes recibidos durante la pausa no se reenvían al bot.

```bash
sql -c "UPDATE core.brands SET bot_enabled = false WHERE slug = 'salvionix' RETURNING slug, bot_enabled;"
```

Para volver a Javier v4, usar la terminal preparada en d. La ruta de v4 debe seguir activa en n8n. El rollback detiene `core-api`, deja el envío apagado y restaura el webhook con el mismo `PUT` de WAHA verificado en el ensayo de b. El comando tiene un límite de 55 segundos. Se considera completo cuando `core-api` está detenido y WAHA vuelve a `WORKING` con el webhook anterior. Si falla una parte, verifica ambos estados y avisa a Joel.

```bash
rollback_to_v4() {
  local -a compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml)
  local stopped=0 disabled=0 running
  cd ~/salvionix-crm-production && test -s "$CUT_DIR/v4.json" || return 1
  export WAHA_SEND_ENABLED=false
  if timeout 6s "${compose[@]}" stop --timeout 0 core-api ||
     timeout 4s "${compose[@]}" kill core-api; then
    stopped=1
  fi
  if sed -i '/^WAHA_SEND_ENABLED=/d' .env &&
     printf '%s\n' 'WAHA_SEND_ENABLED=false' >> .env &&
     timeout 3s "${compose[@]}" exec -T db psql -X -U core_owner -d salvionix -v ON_ERROR_STOP=1 \
       -c "UPDATE core.brands SET bot_enabled = false WHERE slug = 'salvionix';"; then
    disabled=1
  fi
  waha salvionix PUT "$CUT_DIR/v4.json" &&
    wait_working salvionix 16 "$CUT_DIR/v4.json" || return 1
  running=$(timeout 3s "${compose[@]}" ps -q core-api) && [ -z "$running" ] && (( stopped && disabled ))
}
export CUT_DIR WAHA_CONTAINER WAHA_PORT
export -f waha wait_working rollback_to_v4
timeout 55s bash -c 'set -o pipefail; rollback_to_v4'
```

- [ ] Verificar con un mensaje del equipo que vuelve a responder v4. Conservar la base de producción y `core-api` detenido. Antes de preparar un nuevo corte, revisar las entregas que WAHA pudo haber aceptado justo antes de la parada. Mantener el binario compatible con la base migrada.

### Reanudar una conversación escalada

- [ ] Cuando el operador haya atendido la escalación, identificar el ID de la conversación y el de la tarea correspondiente. Esta consulta muestra las pausas abiertas de Salvionix y el vínculo exacto cuando existe.

```bash
sql <<'SQL'
SELECT c.id AS conversation_id, c.contact_id, c.escalation_task_id AS task_id, c.bot_paused_at, c.bot_paused_reason
FROM core.conversations c
JOIN core.brands b ON b.id = c.brand_id
WHERE b.slug = 'salvionix' AND c.closed_at IS NULL AND c.bot_paused
ORDER BY c.bot_paused_at DESC;
SQL
```

- [ ] Para una escalación anterior a la migración `0025`, verificar el contacto, la hora de creación de la tarea original (`due_date`) y el texto de la escalación. Con los dos IDs, ejecutar la actualización. La misma sentencia devuelve los IDs, `bot_paused = f` y `task_status = atendida`. Si devuelve cero filas, revisar la conversación y la tarea. Enviar un mensaje nuevo de control para que el bot vuelva a actuar.

```bash
read -r -p 'ID de la conversación pausada: ' conversation_id
read -r -p 'ID de la tarea atendida: ' task_id
sql -v conversation_id="$conversation_id" -v task_id="$task_id" <<'SQL'
WITH eligible AS MATERIALIZED (
  SELECT c.id AS conversation_id, t.id AS task_id
  FROM core.conversations c
  JOIN core.brands b ON b.id = c.brand_id
  JOIN public.tasks t ON t.contact_id = c.contact_id
  WHERE b.slug = 'salvionix' AND c.closed_at IS NULL AND c.bot_paused
    AND c.id = :'conversation_id'::bigint AND t.id = :'task_id'::bigint
    AND (
      t.id = c.escalation_task_id
      OR (
        c.escalation_task_id IS NULL AND t.type = 'follow-up' AND t.due_date = c.bot_paused_at
        AND t.text = 'Atender a mano: el bot pidió ayuda. Motivo: ' || c.bot_paused_reason
      )
    )
  FOR UPDATE OF c, t
),
resumed AS (
  UPDATE core.conversations c
  SET bot_paused = false, bot_paused_at = NULL, bot_paused_reason = NULL, escalation_task_id = NULL
  FROM eligible e
  WHERE c.id = e.conversation_id
  RETURNING c.id, c.bot_paused
),
attended AS (
  UPDATE public.tasks t SET done_date = COALESCE(t.done_date, now())
  FROM eligible e
  WHERE t.id = e.task_id
  RETURNING t.id, t.done_date
)
SELECT r.id AS conversation_id, r.bot_paused, a.id AS task_id, a.done_date, 'atendida' AS task_status
FROM resumed r CROSS JOIN attended a;
SQL
```

## g. Revisar la primera hora

```bash
"${crm[@]}" ps -a
waha salvionix GET | jq -er '.status'
"${crm[@]}" logs --since=10m --tail=100 core-api gateway
sql <<'SQL'
SELECT b.slug, b.bot_enabled, b.bot_agenda_enabled, b.tax_pct
FROM core.brands b WHERE b.slug = 'salvionix';
SELECT m.direction, count(*) AS messages,
  count(*) FILTER (WHERE m.direction = 'in' AND m.bot_dispatched_at IS NULL) AS awaiting_bot
FROM core.messages m JOIN core.brands b ON b.id = m.brand_id
WHERE b.slug = 'salvionix' AND m.created_at > now() - interval '10 minutes' GROUP BY m.direction;
SELECT o.status, count(*) AS total, max(o.attempts) AS attempts
FROM core.outbox o JOIN core.brands b ON b.id = o.brand_id
WHERE b.slug = 'salvionix' AND (o.created_at > now() - interval '10 minutes' OR o.status IN ('pending', 'sending'))
GROUP BY o.status ORDER BY o.status;
SELECT o.id, o.attempts, o.last_error
FROM core.outbox o JOIN core.brands b ON b.id = o.brand_id
WHERE b.slug = 'salvionix' AND o.last_error LIKE 'delivery_uncertain%'
ORDER BY o.id;
SELECT count(*) AS unrouted
FROM core.unrouted_events WHERE received_at > now() - interval '10 minutes';
SQL
```

- [ ] Vigilar `401` de firma, `400` de payload, `5xx`, `bot rejected the message`, `bot call failed`, `outbox send failed`, cola que crece y sesiones WAHA que salen de `WORKING`. Un `200` de entrada no confirma ni la ejecución en n8n ni el envío al cliente.
- [ ] Revisar en `core-api` el ritmo, las reprogramaciones y los casos `delivery_uncertain`. Cada caso incierto detiene su chat. Revisar las ejecuciones en n8n, las tareas y citas en el panel y cualquier señal de restricción del chip en WAHA. Guardar evidencia con conteos, códigos y estados. Mantener los archivos privados de rollback accesibles hasta cerrar la ventana con Joel.

### Conciliar una entrega incierta

Revisa el chat y la evidencia de WAHA con Joel. Si se confirma que se entregó, márcala `sent` y libera el chat. Si se confirma que WAHA no llegó a enviarla, reencólala con el mismo ID de outbox. Si sigue sin poder confirmarse, déjala en revisión. Ejecuta solo el bloque que corresponda al resultado comprobado. El `UPDATE` debe devolver el ID indicado y su nuevo estado.

```bash
# Entrega confirmada. sent_at registra el momento de la conciliación.
read -r -p 'ID del outbox entregado: ' OUTBOX_ID
sql -v outbox_id="$OUTBOX_ID" <<'SQL'
UPDATE core.outbox o SET status = 'sent', sent_at = now(), last_error = 'delivery_reviewed_sent'
FROM core.brands b
WHERE o.id = :'outbox_id'::bigint AND b.id = o.brand_id AND b.slug = 'salvionix'
  AND o.status = 'failed' AND starts_with(o.last_error, 'delivery_uncertain')
  AND (o.claim_expires_at IS NULL OR o.claim_expires_at <= now())
RETURNING o.id, o.status;
SQL
```

```bash
# No se envió, confirmado en WAHA. La nueva entrega sigue sujeta al límite del outbox.
read -r -p 'ID del outbox que WAHA no envió: ' OUTBOX_ID
sql -v outbox_id="$OUTBOX_ID" <<'SQL'
UPDATE core.outbox o SET status = 'pending', scheduled_at = now(), delivery_retries = 0,
                         claim_expires_at = NULL, send_started_at = NULL, last_error = 'delivery_reviewed_not_sent'
FROM core.brands b
WHERE o.id = :'outbox_id'::bigint AND b.id = o.brand_id AND b.slug = 'salvionix'
  AND o.status = 'failed' AND starts_with(o.last_error, 'delivery_uncertain')
  AND (o.claim_expires_at IS NULL OR o.claim_expires_at <= now())
RETURNING o.id, o.status;
SQL
```

## h. Activar PDF

- [ ] Tras la primera hora estable, confirmar que los textos provisionales están cargados y que el operador puede revisar el PDF de control. Iniciar Gotenberg y esperar a que esté saludable. Activar el envío para Salvionix cuando la imagen confirme `confirmed=true`.

```bash
"${crm[@]}" --profile pdf pull gotenberg &&
  "${crm[@]}" --profile pdf up -d --no-build --wait --wait-timeout 120 gotenberg &&
  "${crm[@]}" exec -T core-api node -e 'process.exit(require("./templates/settings.json").confirmed === true ? 0 : 1)' &&
  sql -c "UPDATE core.brands SET pdf_clientes_reales = true WHERE slug = 'salvionix' RETURNING slug, pdf_clientes_reales;"
```

- [ ] Pedir a un integrante del equipo que envíe desde su número «Quiero cotizar un local con 1731 pies cuadrados cubiertos, sin áreas descubiertas ni adicionales». Usar un contacto que recorra el flujo de cliente real. Confirmar que recibe un solo PDF, con **USD 193** de total y una fila **Descuento**. Abrir el PDF, revisar el sitio y el teléfono del pie, y comprobar que el recuadro con las dos oraciones de garantía de Javier v4 aparece debajo de las formas de pago. Confirmar que no contiene «valor sujeto a revisión final» ni «descuento especial».
- [ ] Si falla el control o se necesita detener los PDF a clientes reales, apagar el interruptor de Salvionix. El cambio cancela las entregas de PDF pendientes para clientes reales. Una entrega que WAHA ya aceptó puede completarse. [Envío de PDF](DATOS_REALES.md#5-envío-de-pdf-a-clientes-reales).

```bash
sql -c "UPDATE core.brands SET pdf_clientes_reales = false WHERE slug = 'salvionix' RETURNING slug, pdf_clientes_reales;"
```

## i. Encender agenda

- [ ] Aprobar con el aplicador las fechas realmente libres. En el VPS, crear `aplicadores.json` a partir del ejemplo con permisos 600. Sustituir las fechas ilustrativas por fechas futuras y usar solo franjas disponibles. Para Aplicador Orlando usar `America/New_York`, prefijos ZIP `327`, `328` y `347`, 60 minutos de servicio y 30 de traslado. La referencia para días libres de lunes a viernes es de 09:00 a 22:00 y para días libres de fin de semana, de 10:00 a 19:00. Cada elemento de `windows` lleva `date` (`AAAA-MM-DD`), `start` y `end` (`HH:MM`) en hora del Este. Las fechas operativas van en el archivo privado del VPS.

```bash
cd ~/salvionix-crm-production
umask 077
test -e aplicadores.json || install -m 600 aplicadores.example.json aplicadores.json
chmod 600 aplicadores.json
${EDITOR:-nano} aplicadores.json
```

- [ ] Cargar la disponibilidad con la agenda del bot apagada. El importador reemplaza las franjas en una transacción y conserva las citas existentes. Confirmar que informa `Imported N availability windows for M technicians` y revisar las franjas locales antes de activar.

```bash
"${crm[@]}" run --rm --no-deps -T migrate node scripts/db-import-availability.ts - < aplicadores.json
sql <<'SQL'
SELECT t.name, t.timezone, t.zip_prefixes, a.service_date, a.start_time, a.end_time
FROM core.technician_dated_availability a
JOIN core.technicians t ON t.id = a.technician_id
JOIN core.brands b ON b.id = t.brand_id
WHERE b.slug = 'salvionix' AND t.active
  AND (a.service_date + a.end_time) AT TIME ZONE t.timezone > now()
ORDER BY a.service_date, a.start_time, t.name;
SQL
```

- [ ] Antes de activar, comprobar que pasó la suite completa de b y probar el flujo en la pila aislada. Con un ZIP cubierto, Javier ofrece como máximo tres horarios, los expresa en hora del Este, permite apartar y confirmar uno y registra la cita y la orden de trabajo en el CRM. Un segundo cliente no puede tomar el mismo horario. El apartado sin confirmar vence a los 15 minutos. Para un ZIP fuera de cobertura, esperar `fuera_de_cobertura` y cero horarios. Con la agenda apagada, esperar `409 agenda_apagada` en `horarios_libres`, `reservar` y `confirmar`. Desde el panel de operador, revisar la edición de una fecha, un bloqueo o ausencia y su retiro, y la liberación de un apartado vigente.
- [ ] Verificar que Gotenberg esté activo en producción y que los textos estén confirmados para emitir la orden de trabajo. Este requisito también aplica si los PDF a clientes reales siguen apagados.

```bash
"${crm[@]}" --profile pdf pull gotenberg &&
  "${crm[@]}" --profile pdf up -d --no-build --wait --wait-timeout 120 gotenberg &&
  "${crm[@]}" exec -T core-api node -e 'process.exit(require("./templates/settings.json").confirmed === true ? 0 : 1)'
```

- [ ] Encender la agenda por separado cuando haya disponibilidad futura dentro del horizonte de oferta y se haya completado la prueba. La actualización devuelve una fila con `bot_agenda_enabled = t`. Si devuelve cero filas, revisar las fechas y la configuración de la marca antes de continuar.

```bash
sql <<'SQL'
UPDATE core.brands b SET bot_agenda_enabled = true
WHERE b.slug = 'salvionix' AND NOT b.bot_agenda_enabled
  AND EXISTS (
    SELECT 1
    FROM core.technician_dated_availability a
    JOIN core.technicians t ON t.id = a.technician_id
    JOIN core.scheduling_settings s ON s.brand_id = t.brand_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(t.timezone, b.timezone) AS zone,
             make_interval(mins => s.slot_minutes + s.buffer_minutes) AS occupied
    ) cfg
    CROSS JOIN LATERAL generate_series(
      (a.service_date + a.start_time) AT TIME ZONE cfg.zone,
      ((a.service_date + a.end_time) AT TIME ZONE cfg.zone) - cfg.occupied,
      cfg.occupied
    ) candidate(start_at)
    WHERE t.brand_id = b.id AND t.active AND t.zip_prefixes IS NOT NULL
      AND a.service_date BETWEEN (now() AT TIME ZONE cfg.zone)::date
        AND (now() AT TIME ZONE cfg.zone)::date + s.horizon_days
      AND candidate.start_at >= now() + make_interval(mins => s.min_notice_minutes)
      AND candidate.start_at < now() + make_interval(days => s.horizon_days)
      AND NOT EXISTS (
        SELECT 1 FROM core.technician_time_off o WHERE o.technician_id = t.id
          AND o.period && tstzrange(candidate.start_at, candidate.start_at + cfg.occupied, '[)')
      )
      AND NOT EXISTS (
        SELECT 1 FROM core.appointments x WHERE x.technician_id = t.id AND NOT x.is_test
          AND x.status NOT IN ('cancelled', 'expired')
          AND NOT (x.status = 'hold' AND x.hold_expires_at <= now())
          AND tstzrange(x.start_at, x.blocked_until, '[)')
              && tstzrange(candidate.start_at, candidate.start_at + cfg.occupied, '[)')
      )
  )
RETURNING b.id, b.slug, b.bot_agenda_enabled;
SQL
```

- [ ] Para detener las herramientas de agenda sin apagar el bot, usar el siguiente comando. Las citas confirmadas quedan registradas.

```bash
sql -c "UPDATE core.brands SET bot_agenda_enabled = false WHERE slug = 'salvionix' RETURNING id, slug, bot_agenda_enabled;"
```
