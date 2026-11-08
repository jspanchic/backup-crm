# Corte de WhatsApp Salvionix · lunes 09/11

La sesión `salvionix` usa WAHA con el chip real. El flujo será `WAHA → core-api → copia de Javier en n8n → core-api → WAHA`. En la copia de Javier se configuran el ritmo anti-bloqueo y el aviso al equipo. Javier v4 queda activo durante el corte y listo para recibir de nuevo el webhook.

## a. Desplegar con el envío apagado

- [ ] Confirmar con Joel el acceso, la arquitectura, la capacidad y la red Docker compartida por WAHA y n8n. Usar las verificaciones de la [guía del VPS](DESPLIEGUE_VPS_PRUEBAS.md#a-verificaciones-previas-en-el-vps-solo-lectura). En el VPS se necesita Bash, `jq`, `timeout` y Docker Compose 2.24.4 o posterior para aplicar el archivo de producción. [Referencia de Docker Compose](https://docs.docker.com/reference/compose-file/merge/#replace-value).
- [ ] Preparar el webhook activo de la copia de Javier en `/webhook/<ruta-de-la-copia>`. Usar el contrato de firma, token y herramientas de la [guía de pruebas](DESPLIEGUE_VPS_PRUEBAS.md#d-conexión-con-n8n). En producción, las herramientas usan `http://salvionix-core-api-production:8080`. Retirar `horarios_libres`, `reservar` y `confirmar` de la copia y usar `responder` como única salida hacia WhatsApp. Si `cotizar` devuelve `impuesto_pct=0`, omitir el renglón de impuesto en el mensaje al cliente. Verificar que la copia rechaza una firma inválida antes de ejecutar las herramientas.

En el PC, desde la raíz del repo, construir para la arquitectura que devuelve `uname -m` en el VPS. Para `aarch64`, poner `linux/arm64` en `$plataforma`.

```powershell
$plataforma = 'linux/amd64'
$vps = Read-Host 'Usuario y host SSH del VPS (usuario@host)'
docker build --platform $plataforma -f infra/vps/core-api.Dockerfile -t salvionix-crm/core-api:production -t salvionix-crm/core-api:test .
docker build --platform $plataforma -f infra/vps/panel.Dockerfile -t salvionix-crm/panel:test .
docker save -o salvionix-imagenes.tar salvionix-crm/core-api:production salvionix-crm/core-api:test salvionix-crm/panel:test
ssh $vps 'mkdir -p ~/salvionix-crm-production ~/salvionix-crm'
scp salvionix-imagenes.tar "${vps}:~/"
scp infra/vps/docker-compose.yml infra/vps/docker-compose.production.yml infra/vps/gateway.nginx.template infra/vps/configure-production.sql infra/vps/precios-salvionix.json infra/vps/.env.example "${vps}:~/salvionix-crm-production/"
scp infra/vps/docker-compose.yml infra/vps/gateway.nginx.template infra/vps/.env.example infra/vps/send-test-message.mjs "${vps}:~/salvionix-crm/"
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
crm=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml)
sql() { "${crm[@]}" exec -T db psql -X -U core_owner -d salvionix -v ON_ERROR_STOP=1 "$@"; }
export WAHA_SEND_ENABLED=false
"${crm[@]}" config -q &&
  "${crm[@]}" up -d --no-build --wait --wait-timeout 120 db migrate postgrest core-api gateway
"${crm[@]}" ps -a
"${crm[@]}" logs --tail=25 migrate
sql < configure-production.sql
"${crm[@]}" exec -T core-api node -e 'process.exit(process.env.BOT_URL_JAVIER?.startsWith("http://gateway:8081/webhook/") && process.env.WAHA_SEND_ENABLED === "false" ? 0 : 1)'
```

- [ ] Cargar `precios-salvionix.json`. Las tarifas y el cálculo de Javier v4 están aprobados. Los factores para estimar metraje siguen marcados como provisionales en el archivo. Continuar si el importador confirma `3 controls passed`. Con 1.731 pies² cubiertos se esperan USD 208 de subtotal, 15 de descuento y 193 de total. Con 8.000 cubiertos y 3.000 descubiertos se esperan USD 1.140, 80 y 1.060. Por debajo del mínimo se esperan USD 150 y la marca de mínimo aplicado. [Datos reales](DATOS_REALES.md).

```bash
"${crm[@]}" run --rm --no-deps -T migrate node scripts/db-import-pricing.ts - < precios-salvionix.json
```

- [ ] Validar la base y la puerta interna. En una instalación nueva, esperar impuesto 0, bot y agenda en `f`, un canal `salvionix` real y activo, y cero técnicos, contactos y mensajes en cola. Dejar el panel de producción apagado hasta contar con autenticación de operadores.

```bash
sql <<'SQL'
SELECT slug, tax_pct, bot_enabled, bot_agenda_enabled FROM core.brands WHERE slug = 'salvionix';
SELECT provider, identifier, bot_key, is_test, active FROM core.channels;
SELECT count(*) AS technicians FROM core.technicians;
SELECT count(*) AS contacts FROM public.contacts;
SELECT count(*) AS queued FROM core.outbox WHERE status IN ('pending', 'sending');
SQL
"${crm[@]}" exec -T gateway wget -qO- http://127.0.0.1:8080/healthz
read -r -p 'Contenedor de n8n: ' N8N_CONTAINER
docker exec "$N8N_CONTAINER" wget -qO- http://salvionix-core-api-production:8080/healthz
docker exec "$N8N_CONTAINER" wget -S -O /dev/null http://salvionix-core-api-production:8080/admin/session
# healthz = {"status":"ok"}. /admin/session = 403.
```

## b. Probar en la pila aislada

- [ ] Usar el proyecto `salvionix-crm` de la [guía de pruebas](DESPLIEGUE_VPS_PRUEBAS.md). Preparar su configuración privada según b.4 y d.5 de la guía. Usar el `core-api:test` recién construido y una copia de ensayo de Javier con la misma lógica, HMAC de ensayo y herramientas en `http://salvionix-core-api:8080`.

```bash
cd ~/salvionix-crm
export WAHA_SEND_ENABLED=false WAHA_BASE_URL=http://waha.invalid:3000 WAHA_UPSTREAM=waha.invalid:3000
docker compose config -q && docker compose up -d --no-build --wait --wait-timeout 120 &&
  test "$(docker inspect --format '{{.Image}}' "$(docker compose ps -q core-api)")" = \
    "$(docker image inspect --format '{{.Id}}' salvionix-crm/core-api:test)" &&
  docker compose run --rm --no-deps migrate node scripts/db-seed.ts &&
  docker compose exec -T core-api node --input-type=module - 14075550150 \
    'Hola, quiero cotizar 8000 pies cubiertos y 3000 descubiertos' < send-test-message.mjs
docker compose logs --tail=50 core-api
```

- [ ] Esperar `core-api answered 200`. Verificar que la copia de ensayo ejecuta las herramientas y que `responder` deja una respuesta en la conversación de prueba. El código 200 solo confirma la recepción. El valor USD 1.060 se valida con el importador en a.
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

- [ ] Confirmar que un mensaje real de BYTOGAM se despacha a la copia de ensayo. Restaurar su configuración y medir la vuelta a `WORKING`. Si el ensayo de restauración falla o demora un minuto o más, aplazar el corte.

```bash
time (test -s "$CUT_DIR/bytogam-antes.json" && waha bytogam-pruebas PUT "$CUT_DIR/bytogam-antes.json" &&
  wait_working bytogam-pruebas 20 "$CUT_DIR/bytogam-antes.json")
```

## c. Habilitar la salida a WAHA

- [ ] Volver a `~/salvionix-crm-production`. Verificar otra vez que la cola de producción está vacía y que el bot sigue apagado. Confirmar que los nodos de envío directo están deshabilitados en la copia de Javier.
- [ ] Configurar de forma persistente en el `.env` **de producción** `WAHA_SEND_ENABLED`, `WAHA_UPSTREAM`, `WAHA_BASE_URL` y `WAHA_API_KEY`. La clave se toma de Bitwarden si WAHA la requiere. Para las otras tres variables, usar los comandos siguientes con el nombre y puerto interno verificados de WAHA. En WAHA y n8n se conserva la red compartida de a.

```bash
cd ~/salvionix-crm-production
read -r -p 'Contenedor de WAHA: ' WAHA_CONTAINER
read -r -p 'Puerto interno de WAHA: ' WAHA_PORT
[[ "$WAHA_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ && "$WAHA_PORT" =~ ^[0-9]+$ ]] &&
  sed -i -e '/^WAHA_SEND_ENABLED=/d' -e '/^WAHA_BASE_URL=/d' -e '/^WAHA_UPSTREAM=/d' .env &&
  printf '%s\n' 'WAHA_SEND_ENABLED=true' 'WAHA_BASE_URL=http://gateway:8082' \
    "WAHA_UPSTREAM=$WAHA_CONTAINER:$WAHA_PORT" >> .env
unset WAHA_SEND_ENABLED WAHA_BASE_URL WAHA_UPSTREAM
"${crm[@]}" config -q &&
  "${crm[@]}" up -d --no-build --wait --wait-timeout 120 core-api gateway
"${crm[@]}" exec -T core-api node -e 'process.exit(process.env.WAHA_SEND_ENABLED === "true" ? 0 : 1)' && echo 'Envío habilitado'
sql -c "SELECT count(*) AS queued FROM core.outbox WHERE status IN ('pending', 'sending');"
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

- [ ] Una vez revisadas ambas peticiones, habilitar el bot y aplicar el cambio. La actualización exige una lista vigente aprobada, impuesto 0, agenda apagada y cola vacía. Si el cambio o la comprobación falla, ejecutar f.

```bash
enable_salvionix_bot() {
  local changed
  changed=$(sql -qAt <<'SQL'
UPDATE core.brands b SET bot_enabled = true
WHERE b.slug = 'salvionix' AND NOT b.bot_enabled AND NOT b.bot_agenda_enabled
  AND b.tax_pct = 0 AND b.discount_enabled
  AND EXISTS (SELECT 1 FROM core.price_lists p
              WHERE p.id = core.active_price_list(b.id) AND p.is_confirmed AND p.currency = 'USD')
  AND NOT EXISTS (SELECT 1 FROM core.outbox WHERE status IN ('pending', 'sending'))
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

## f. Apagar el bot o volver a v4

Interruptor de Salvionix. Toma efecto al confirmar la actualización en la base. `core-api` sigue guardando las entradas, bloquea las herramientas con `409 bot_disabled` y descarta el trabajo pendiente del bot. Una petición a WAHA que ya salió puede terminar. Para reanudar tras revisar la causa, ejecutar `enable_salvionix_bot` y enviar un mensaje nuevo de control. Los mensajes recibidos durante la pausa no se reenvían al bot.

```bash
sql -c "UPDATE core.brands SET bot_enabled = false WHERE slug = 'salvionix' RETURNING slug, bot_enabled;"
```

Para volver a Javier v4, usar la terminal preparada en d. La ruta de v4 debe seguir activa en n8n. La restauración usa el mismo `PUT` que se ensayó en BYTOGAM. El comando tiene un límite de 55 segundos para apagar, restaurar y verificar `WORKING`. Si no se cumple, conservar el bot apagado, consultar el estado de la sesión y avisar a Joel.

```bash
rollback_to_v4() {
  local -a compose=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml)
  test -s "$CUT_DIR/v4.json" &&
    { timeout 5s "${compose[@]}" exec -T db psql -X -U core_owner -d salvionix -v ON_ERROR_STOP=1 \
        -c "UPDATE core.brands SET bot_enabled = false WHERE slug = 'salvionix';" ||
      timeout 5s "${compose[@]}" kill core-api; } &&
    waha salvionix PUT "$CUT_DIR/v4.json" &&
    wait_working salvionix 45 "$CUT_DIR/v4.json"
}
export CUT_DIR WAHA_CONTAINER WAHA_PORT
export -f waha wait_working rollback_to_v4
timeout 55s bash -c 'set -o pipefail; rollback_to_v4'
```

- [ ] Verificar con un mensaje del equipo que vuelve a responder v4. Conservar la base de producción y revisar el intervalo del corte antes de cualquier reintento. Si se usó `kill`, confirmar `bot_enabled = false` antes de levantar de nuevo `core-api`.

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
SELECT count(*) AS unrouted
FROM core.unrouted_events WHERE received_at > now() - interval '10 minutes';
SQL
```

- [ ] Vigilar `401` de firma, `400` de payload, `5xx`, `bot rejected the message`, `bot call failed`, `outbox send failed`, cola que crece y sesiones WAHA que salen de `WORKING`. Un `200` de entrada no confirma ni la ejecución en n8n ni el envío al cliente.
- [ ] Revisar en n8n las ejecuciones, el ritmo, los avisos y cualquier señal de restricción del chip. Guardar evidencia con conteos, códigos y estados. Mantener los archivos privados de rollback accesibles hasta cerrar la ventana con Joel.
