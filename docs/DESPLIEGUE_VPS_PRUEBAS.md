# Despliegue del CRM en el VPS de pruebas

Guía paso a paso para dejar el CRM (base de datos, PostgREST, `core-api`, panel y una puerta nginx hacia n8n) en el VPS donde corre n8n, **solo para probar la copia de Javier v4 con datos de prueba**. No hay clientes reales y no se toca WhatsApp real.

- **Estado:** el paquete está probado en local (ver "Qué se probó"). **No se ha ejecutado nada en el VPS.**
- **Paquete:** `infra/vps/` (`docker-compose.yml`, `.env.example`, `core-api.Dockerfile`, `panel.Dockerfile`, `panel-nginx.conf`, `gateway.nginx.template`, `clean-test-data.sql`, `send-test-message.mjs`).
- **Regla de oro:** este stack es un proyecto Docker aparte (`salvionix-crm`). No modifica n8n, WAHA ni sus volúmenes, y se borra entero con la sección h. **No recrear, reiniciar ni reconfigurar los contenedores de n8n ni de WAHA** sin acordarlo con Joel.

## 0. Qué se despliega y qué hay que saber antes

| Servicio | Imagen | Red | Puerto | Techo de memoria |
|---|---|---|---|---:|
| `db` | `postgres:17.10` | `back` (interna) | ninguno | 512 MB |
| `migrate` (un solo uso) | la de `core-api` | `back` | ninguno | 256 MB |
| `postgrest` | `postgrest/postgrest:v16.4` | `back` | ninguno | 128 MB |
| `core-api` | `salvionix-crm/core-api:test` | `back` (solo) | ninguno | 256 MB |
| `gateway` | `nginx:1.30.6-alpine` | `back` + red de n8n | ninguno publicado | 32 MB |
| `panel` | `salvionix-crm/panel:test` (nginx) | `back` + `edge` | `127.0.0.1:8088` del VPS | 64 MB |
| `gotenberg` (opcional, perfil `pdf`) | `gotenberg/gotenberg:8.38.1` | `back` | ninguno | 1 GB |

Cada contenedor lleva además límite de CPU y registros `json-file` rotados (3 archivos de 10 MB) para no llenar el disco. Uso real medido en reposo en local: db unos 85 MB, `core-api` unos 50 MB, panel unos 25 MB, PostgREST unos 12 MB.

**Cosas que no son obvias:**

1. **Nada queda publicado a internet.** El único puerto publicado es el del panel, y solo en `127.0.0.1` del VPS: se ve con un túnel SSH (sección f). La red `back` es `internal` (sin salida a internet); `edge` existe solo para poder publicar el puerto del panel.
2. **`core-api` corre con `NODE_ENV=development` y una identidad de desarrollo (`ADMIN_DEV_SUB`).** El proxy `/admin/*` que usa el panel solo se monta fuera de producción (en producción lo reemplazará Cloudflare Access, CRM-T3, que aún no existe), y no pide autenticación. Por eso **`core-api` no está en la red de n8n**: lo único que toca esa red es el `gateway`, un nginx mínimo que deja pasar a n8n solo `/tools/*`, `/healthz` y `POST /hooks/whatsapp`. `/admin/*` y todo lo demás responde `403` desde la red de n8n y solo se usa desde el panel, que llega por `127.0.0.1` del VPS (túnel SSH). Es la opción estricta y es la que trae el paquete.
3. **Cómo habla `core-api` con n8n y WAHA:** como no está en la red de n8n, sale por el mismo `gateway`: `:8081` reenvía solo `POST /webhook/*` a n8n (por eso `BOT_URL_JAVIER` apunta a `http://gateway:8081/...`) y `:8082` solo `POST /api/sendText` y `/api/sendFile` a WAHA. Esos dos puertos también se ven desde la red de n8n, pero solo reenvían a n8n y WAHA, que ya están en ella. El `gateway` necesita saber dónde están: `N8N_UPSTREAM` (nombre del contenedor de n8n y su puerto) y, para la prueba con WAHA, `WAHA_UPSTREAM`.4. **WhatsApp:** por defecto `WAHA_BASE_URL` apunta a un nombre que no existe (`waha.invalid`), así que los envíos del outbox fallan sin tocar WhatsApp real. Para una prueba controlada, ver la sección d.7. No se cambian los webhooks de WAHA.
5. **Gotenberg (PDF)** pesa 2,5 GB en disco y puede usar 1 GB de RAM. Sin él, `cotizar` y `confirmar` devuelven `pdf: no_disponible` y no se pierde nada. Decide en la sección a si se activa.

## a) Verificaciones previas (en el VPS, solo lectura)

Todo esto solo lee. Anota los resultados.

```bash
# 1. Arquitectura. x86_64 = imágenes normales. aarch64 = hay que construir con --platform linux/arm64 (sección b).
uname -m

# 2. RAM: mira la columna "available". Sin PDF conviene tener más de 1,2 GB disponibles; con PDF, más de 2,5 GB.
free -m

# 3. Disco: sin PDF el paquete ocupa unos 1,1 GB (con PDF, 3,6 GB). Conviene tener 3 GB libres (6 GB con PDF).
df -h / /var/lib/docker

# 4. Versiones de Docker (se necesita Compose v2: "docker compose", no "docker-compose").
docker --version && docker compose version

# 5. Puertos ocupados en el VPS (el panel usará 8088 en 127.0.0.1; si está ocupado, elige otro en PANEL_PORT).
ss -ltnp | grep -E ':8088\b' || echo "8088 libre"
ss -ltn

# 6. Contenedores en marcha: nombre, imagen y puertos. Aquí ves el de n8n y el de WAHA.
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

# 7. Nombre del contenedor de n8n (ajusta el filtro si hace falta) y su puerto interno (suele ser 5678).
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i n8n
docker inspect NOMBRE_DEL_CONTENEDOR_N8N --format '{{json .Config.ExposedPorts}}'

# 8. Nombre de la red Docker de n8n: es lo que va en N8N_DOCKER_NETWORK. Si salen varias, elige la que
#    comparten n8n y WAHA; con n8n solo basta la suya. No uses "bridge" ni "host" salvo que no haya otra.
docker inspect NOMBRE_DEL_CONTENEDOR_N8N --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
docker network ls

# 9. ¿Está WAHA en esa misma red? (solo hace falta para la prueba controlada de la sección d.7)
docker network inspect NOMBRE_DE_LA_RED --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}'

# 10. Que no haya ya algo llamado core-api / salvionix-core-api en esa red, ni otro proyecto salvionix-crm.
docker network inspect NOMBRE_DE_LA_RED --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' | grep -Ei 'core-api' || echo "sin choques de nombre"
docker compose ls
docker volume ls | grep salvionix-crm || echo "sin volúmenes salvionix-crm"

# 11. Ajustes de n8n que importan para la sección d (solo estos nombres; no imprime el resto del entorno).
docker inspect NOMBRE_DEL_CONTENEDOR_N8N --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(N8N_BLOCK_ENV_ACCESS_IN_NODE|N8N_PORT|N8N_PROTOCOL|WEBHOOK_URL)=' || echo "ninguno de esos ajustes está definido"
```

**Decide con lo que salga:** arquitectura, si hay RAM y disco, si el 8088 está libre, el nombre de la red y del contenedor de n8n, y si se activa el PDF. Si algo no cuadra, no sigas.

**Toma ahora la foto "antes"** (la función `snap` está en la sección e): `snap antes`.

## b) Construir las imágenes y subir los archivos (sin secretos)

Las imágenes se construyen **en el PC** (el `vite build` del panel gasta mucha memoria) y se pasan al VPS. En el VPS solo se copian tres archivos del repositorio. **Ningún archivo con secretos viaja ni se versiona.**

**1. En el PC** (PowerShell, desde `C:\salvionix-platform`; Docker Desktop encendido):

```powershell
docker build -f infra/vps/core-api.Dockerfile -t salvionix-crm/core-api:test .
docker build -f infra/vps/panel.Dockerfile -t salvionix-crm/panel:test .
```

- Si el VPS es `aarch64`: añade `--platform linux/arm64` a los dos `docker build`. Gotenberg usa un digest fijo; si en arm64 no arranca, avisa (no es imprescindible).
- El panel nace en "modo presentación" (datos de prueba siempre visibles). Para quitarlo: `--build-arg PANEL_PRESENTATION_MODE=false`.

**2. Pasar las imágenes al VPS** (sustituye `USUARIO@VPS` por el acceso SSH de siempre):

```powershell
docker save salvionix-crm/core-api:test salvionix-crm/panel:test | gzip | ssh USUARIO@VPS "gunzip | docker load"
```

Si el PC no tiene `gzip`, guarda un archivo con `docker save -o crm-imagenes.tar ...`, súbelo con `scp crm-imagenes.tar USUARIO@VPS:~/` y en el VPS ejecuta `docker load -i ~/crm-imagenes.tar` (borra el `.tar` después). Comprueba en el VPS: `docker images | grep salvionix-crm` debe mostrar las dos imágenes.

**3. Subir los archivos del paquete** (solo estos; no incluyen secretos):

```powershell
ssh USUARIO@VPS "mkdir -p ~/salvionix-crm"
scp infra/vps/docker-compose.yml infra/vps/gateway.nginx.template infra/vps/.env.example infra/vps/clean-test-data.sql infra/vps/send-test-message.mjs USUARIO@VPS:~/salvionix-crm/
```

(Alternativa con git: clonar el repositorio en el VPS y trabajar desde `infra/vps/`. Funciona igual, pero trae todo el código; para pruebas basta con copiar los cinco archivos.)

**4. Crear el `.env` en el VPS** (los secretos se generan allí y nunca se imprimen ni se copian por chat):

```bash
cd ~/salvionix-crm
cp .env.example .env && chmod 600 .env

# Contraseñas y secretos aleatorios, en hexadecimal (no rompen la URL de PostgREST). No se muestran.
for v in PG_SUPERUSER_PASSWORD CORE_OWNER_PASSWORD CORE_API_PASSWORD AUTHENTICATOR_PASSWORD \
         PGRST_JWT_SECRET CONVERSATION_TOKEN_SECRET BOT_HMAC_SECRET WAHA_HMAC_BYTOGAM_PRUEBAS; do
  sed -i "s|^$v=.*|$v=$(openssl rand -hex 24)|" .env
done

# Lo que sí hay que escribir a mano (nombre de la red de n8n, de la sección a):
sed -i "s|^N8N_DOCKER_NETWORK=.*|N8N_DOCKER_NETWORK=NOMBRE_DE_LA_RED|" .env
# Dónde está n8n dentro de esa red: nombre del contenedor y puerto interno (comando 7 de la sección a). El gateway reenvía el webhook del bot ahí.
sed -i "s|^N8N_UPSTREAM=.*|N8N_UPSTREAM=NOMBRE_DEL_CONTENEDOR_N8N:5678|" .env
# Si el 8088 estaba ocupado:  sed -i "s|^PANEL_PORT=.*|PANEL_PORT=18088|" .env

# Comprobar qué variables tienen valor, sin mostrar el valor:
awk -F= '/^[A-Z0-9_]+=/ {print $1, ($2=="" ? "vacío" : "con valor")}' .env
```

Deben quedar **con valor**: `N8N_DOCKER_NETWORK`, `N8N_UPSTREAM`, las cuatro contraseñas, los tres secretos de firma y `WAHA_HMAC_BYTOGAM_PRUEBAS`. Pueden quedar **vacías**: `BOT_URL_JAVIER` (se rellena en la sección d), `WAHA_BASE_URL`, `WAHA_UPSTREAM`, `WAHA_API_KEY`, `OUTBOX_*`, `PANEL_PORT`, `ADMIN_DEV_SUB`, `ADMIN_ALLOWED_ORIGINS`, `LOG_LEVEL`, `PANEL_PRESENTATION_MODE` (usan su valor por defecto). **No pegues el contenido del `.env` en ningún chat, correo ni archivo.**

Para activar el PDF, añade al final del `.env`: `COMPOSE_PROFILES=pdf` (y haz antes `docker pull gotenberg/gotenberg:8.38.1`, que son 2,5 GB).

## c) Desplegar y migrar

Todo desde `~/salvionix-crm` (ahí está el `.env`, que Compose lee solo). Cada comando de Compose necesita `N8N_DOCKER_NETWORK`, también `down`.

```bash
cd ~/salvionix-crm

# 1. Validar el archivo. Si falta una variable, dice cuál (nunca su valor).
docker compose config -q && echo "compose OK"

# 2. Levantar. --no-build: usa las imágenes cargadas en la sección b (si faltaran, falla en vez de descargar nada).
docker compose up -d --no-build

# 3. Estado. Esperado: db, core-api y gateway "healthy"; migrate "Exited (0)"; postgrest y panel "Up".
docker compose ps -a

# 4. Las migraciones (bootstrap de roles + 17 archivos). La última línea de la lista debe ser 0017_documents_in_flows.sql.
docker compose logs migrate | tail -25
```

**Datos de ejemplo** (una marca, lista de precios, canal de pruebas `bytogam-pruebas` con bot `javier`, la responsable de ejemplo «Sebastián (demo)» y un técnico). Es un paso explícito y se puede repetir sin duplicar:

```bash
docker compose run --rm migrate node scripts/db-seed.ts      # debe decir: sample data loaded
```

Opcional, para que el panel no se vea vacío: datos ficticios de la presentación (12 contactos, 12 oportunidades; todo `is_test`):

```bash
docker compose run --rm migrate node scripts/db-seed-presentacion.ts
```

Comprobaciones de que todo respondió:

```bash
# core-api por dentro del contenedor
docker compose exec -T core-api node -e "fetch('http://127.0.0.1:3000/healthz').then(async r=>console.log(r.status, await r.text()))"
# El panel, en el loopback del VPS (ajusta el puerto si cambiaste PANEL_PORT)
curl -s -o /dev/null -w "panel %{http_code}\n" http://127.0.0.1:8088/
curl -s -w "\nsesión %{http_code}\n" http://127.0.0.1:8088/admin/session      # 200 con la responsable de ejemplo = nginx llega a core-api, core-api a PostgREST y PostgREST a la base
# Ningún puerto publicado salvo el del panel, en 127.0.0.1:
docker ps --filter label=com.docker.compose.project=salvionix-crm --format '{{.Names}}  {{.Ports}}'
# Consumo real contra los techos:
docker stats --no-stream $(docker ps -q --filter label=com.docker.compose.project=salvionix-crm)
```

Si algo falla: `docker compose logs --tail=50 SERVICIO` (core-api, postgrest, db, panel). Los registros de `core-api` no llevan mensajes ni cuerpos de peticiones.

## d) Conexión con n8n

**URL interna final que usa n8n** (la del `gateway`, puerto 8080 de la red de n8n):

```text
http://salvionix-core-api:8080
```

Las herramientas son `http://salvionix-core-api:8080/tools/<nombre>`. Desde la red de n8n **solo** responden `/tools/*`, `GET /healthz` y `POST /hooks/whatsapp`; cualquier otra ruta (`/admin/*` incluida) da `403`. Desde `core-api` hacia n8n el camino es otro (d.5).

### d.1 Comprobar la URL desde n8n

Prueba rápida desde el propio contenedor de n8n (solo lee, no cambia nada). La imagen de n8n suele traer `wget`:

```bash
docker exec NOMBRE_DEL_CONTENEDOR_N8N wget -qO- http://salvionix-core-api:8080/healthz      # {"status":"ok"}
```

Una herramienta con token inválido debe dar `401`: es la prueba de que se llegó a `core-api` a través de la puerta:

```bash
docker exec NOMBRE_DEL_CONTENEDOR_N8N wget -qO- --header='Authorization: Bearer x' http://salvionix-core-api:8080/tools/ficha
# wget imprime "server returned error: HTTP/1.1 401 Unauthorized" (invalid_token, de core-api)
```

Y `/admin/*` debe estar cerrado desde esa red:

```bash
docker exec NOMBRE_DEL_CONTENEDOR_N8N wget -qO- http://salvionix-core-api:8080/admin/session
# wget imprime "server returned error: HTTP/1.1 403 Forbidden"
```

(Si no hay `wget`: `docker run --rm --network NOMBRE_DE_LA_RED node:24.22.2-alpine node -e "fetch('http://salvionix-core-api:8080/healthz').then(async r=>console.log(r.status, await r.text()))"` solo funciona si esa imagen ya está en el VPS; si no, no la descargues solo para esto.)

### d.2 Nombres de encabezados y variables (sin valores)

**Encabezados**

| Quién → a quién | Encabezado | Contenido |
|---|---|---|
| `core-api` → n8n (webhook del bot) | `X-Core-Timestamp` | Segundos desde 1970 |
| `core-api` → n8n | `X-Core-Signature` | HMAC-SHA256 hexadecimal de `timestamp + "." + cuerpo crudo`, con `BOT_HMAC_SECRET` |
| n8n → `core-api` (herramientas) | `Authorization` | `Bearer <token>`: el campo `token` del cuerpo del webhook de entrada (vale 15 minutos). **n8n no lo genera ni lo modifica** |
| n8n → `core-api` (herramientas) | `Content-Type` | `application/json` (en los POST; cuerpo de máximo 16 KB y esquema estricto) |
| WAHA → `core-api` (solo si se conectara) | `X-Webhook-Hmac`, `X-Webhook-Hmac-Algorithm`, `X-Webhook-Timestamp` | Firma HMAC-SHA512 del cuerpo con `WAHA_HMAC_BYTOGAM_PRUEBAS`. **El lunes no se toca ningún webhook de WAHA** |

**Variables en n8n** (las que usa la copia de Javier)

| Variable | Qué lleva |
|---|---|
| `CORE_API_INTERNAL_URL` | La URL interna final de arriba (`http://salvionix-core-api:8080`) |
| `BOT_HMAC_SECRET` | El mismo valor que `BOT_HMAC_SECRET` del `.env` del VPS; verifica la firma de lo que llega de `core-api` |

**Variables en el `.env` del VPS** relacionadas con n8n: `N8N_DOCKER_NETWORK`, `N8N_UPSTREAM`, `BOT_URL_JAVIER`, `BOT_HMAC_SECRET`, `WAHA_BASE_URL`, `WAHA_UPSTREAM`, `WAHA_API_KEY`, `WAHA_HMAC_BYTOGAM_PRUEBAS`. `CONVERSATION_TOKEN_SECRET` es solo de `core-api`: n8n no la necesita.

**Cómo llegan las dos variables de n8n, con cuidado:**

- n8n puede tener **bloqueado `$env`** en los nodos (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, lo que muestra el comando 11 de la sección a). Y **cambiar el entorno de un contenedor obliga a recrearlo**, lo que reinicia n8n y puede cortar a Javier v4 y a WAHA. **No lo hagas el lunes sin acordarlo con Joel.**
- **Camino que no toca n8n:** en la **copia de pruebas**, un nodo `Edit Fields (Set)` llamado `Config` con esos dos valores (d.3). El secreto es **solo de pruebas**: el que generó el `.env` de este stack, distinto de cualquier secreto real. **No exportes ni versiones la copia** con el secreto dentro, y bórrala al terminar (sección h). Cópialo a mano desde una sesión SSH privada; no lo envíes por chat.

### d.3 Pasos en n8n: encabezados y credenciales de las herramientas

No hace falta crear una credencial de n8n para las herramientas: el `Authorization` cambia en cada mensaje (el token dura 15 minutos y viaja en el webhook), así que una credencial fija (por ejemplo `Header Auth`) no sirve para eso. Se arma con **expresiones** en la copia de Javier. Los nombres de menús pueden variar un poco según la versión de n8n; si algo no coincide, avisa y lo ajustamos mirando la pantalla.

1. **Nodo `Webhook` de entrada**: método `POST`, una ruta **nueva** (distinta de la de Javier v4 real), `Respond: Immediately` (responde `2xx` sin cuerpo) y, en `Options`, activa `Raw Body` (la firma se calcula sobre el cuerpo crudo).
2. **Nodo `Config`** (`Edit Fields (Set)`, justo después del webhook): dos campos de texto, `core_api_url` (la URL interna final) y `bot_hmac_secret` (el valor de pruebas).
3. **Nodo `Verificar firma`** (`Code`, JavaScript): recalcula el HMAC-SHA256 de `X-Core-Timestamp + "." + cuerpo crudo` con `bot_hmac_secret`, lo compara con `X-Core-Signature` y rechaza si el timestamp difiere más de 5 minutos. Esqueleto (hay que ajustarlo y probarlo con la sección d.6; necesita que el nodo `Code` permita `crypto`, algo que el contrato ya da por supuesto):

   ```javascript
   const crypto = require('crypto');
   const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
   const headers = $('Webhook').first().json.headers;
   const secret = $('Config').first().json.bot_hmac_secret;
   const expected = crypto.createHmac('sha256', secret).update(headers['x-core-timestamp'] + '.' + raw).digest('hex');
   const fresh = Math.abs(Date.now() / 1000 - Number(headers['x-core-timestamp'])) <= 300;
   if (!fresh || expected !== headers['x-core-signature']) throw new Error('firma invalida');
   return [{ json: JSON.parse(raw) }];
   ```
4. **Cada nodo `HTTP Request` de una herramienta** (`ficha`, `guardar_datos`, `cotizar`, `escalar`, `horarios_libres`, `reservar`, `confirmar`, `responder`):
   - `Method`: `GET` para `ficha`, `POST` para las demás.
   - `URL`: `{{ $('Config').first().json.core_api_url }}/tools/ficha` (cambia el final por cada herramienta).
   - `Send Headers` activado, `Specify Headers`: `Using Fields Below`, y dos encabezados: `Authorization` = `Bearer {{ $('Verificar firma').first().json.token }}` y `Content-Type` = `application/json` (este último solo en los POST).
   - `Send Body` (solo POST): `JSON`, con el cuerpo de la herramienta (ver `docs/contratos/core-api-n8n.md`, sección 4b).
   - Sin autenticación de n8n (`Authentication: None`): la autorización es el encabezado de arriba.
5. Prueba: manda el mensaje de la sección d.6 y mira en el panel que la respuesta de Javier llega a la conversación.

### d.4 Resultados esperables de las herramientas

`401 invalid_token` (token vencido o inventado), `409 bot_paused`, `400 invalid_input`, `422 reply_rejected`. n8n **no** necesita ninguna llave de base de datos, de WAHA ni de canales.

### d.5 Ruta del webhook de la copia y `BOT_URL_JAVIER`

1. En la copia de Javier anota la ruta del nodo Webhook de entrada. **Debe ser distinta de la de Javier v4 real**, para que `core-api` nunca llame al real. Usa la URL de producción del webhook (`/webhook/...`, con el workflow **activo**), no la de prueba (`/webhook-test/...`): el gateway solo deja pasar `/webhook/*`.
2. `core-api` llega a n8n **a través del gateway**, no directo: `BOT_URL_JAVIER=http://gateway:8081/webhook/RUTA_DE_LA_COPIA`. El gateway lo reenvía a `N8N_UPSTREAM` (nombre del contenedor de n8n y puerto, ya puestos en el `.env`).
3. Ponla en el `.env` del VPS y recrea **solo** `core-api`:

```bash
cd ~/salvionix-crm
sed -i "s|^BOT_URL_JAVIER=.*|BOT_URL_JAVIER=http://gateway:8081/webhook/RUTA_DE_LA_COPIA|" .env
docker compose up -d --no-build core-api
```
### d.6 Disparar una conversación de prueba sin WhatsApp

`send-test-message.mjs` manda **un** mensaje ficticio firmado como lo haría WAHA, dentro del contenedor (la clave nunca se imprime). Usa un número ficticio (555-01xx):

```bash
cd ~/salvionix-crm
docker compose exec -T core-api node --input-type=module - 14075550150 "Hola, quiero información para desinfectar mi restaurante" < send-test-message.mjs
# core-api answered 200
```

`core-api` guarda el mensaje, crea el contacto («WhatsApp ••0150», marcado como prueba) y llama a la copia de Javier. Su respuesta entra por `/tools/responder` y se ve en la ficha del contacto en el panel. El envío real al cliente falla a propósito (no hay WAHA): es lo esperado.

### d.7 Una prueba controlada con WAHA real (solo si se acuerda)

Solo con **un chip propio de Sebastián**, **un** mensaje, y con Joel enterado. No hay pruebas masivas por WhatsApp.

1. WAHA debe estar en la red de n8n (comando 9 de la sección a). Anota su nombre de contenedor y puerto.
2. La sesión de WAHA debe llamarse igual que el canal de pruebas: `bytogam-pruebas`. Si no, el nombre del canal se ajusta en la base de este stack (no en WAHA); se decide ese día.
3. En el `.env`: `WAHA_UPSTREAM=NOMBRE_DEL_CONTENEDOR_WAHA:PUERTO` y `WAHA_BASE_URL=http://gateway:8082` (y `WAHA_API_KEY` solo si WAHA la pide). `core-api` habla con WAHA **a través del gateway**, que solo deja pasar `POST /api/sendText` y `/api/sendFile`. Recrea `gateway` y `core-api`: `docker compose up -d --no-build gateway core-api`.
4. **No se cambia ningún webhook de WAHA**: la entrada de ese mensaje se simula con la sección d.6, con el número del chip propio en lugar del ficticio. Lo único real es el envío de la respuesta.
5. Al terminar, deja `WAHA_BASE_URL=` y `WAHA_UPSTREAM=` vacíos de nuevo y recrea `gateway` y `core-api`.

## e) Comprobar que n8n, WAHA y Javier v4 siguen igual (foto antes y después)

Define la función una vez por sesión SSH. Guarda estado, no secretos (no imprime variables de entorno):

```bash
snap() {
  f=~/snap-$1.txt
  {
    echo "## contenedores (fuera de salvionix-crm)"
    docker ps -a --format '{{.Names}}  {{.Image}}  {{.State}}' | grep -v '^salvionix-crm-'
    echo "## arranque y reinicios (debe ser idéntico antes y después)"
    for c in $(docker ps -a --format '{{.Names}}' | grep -v '^salvionix-crm-'); do
      docker inspect "$c" --format '{{.Name}} started={{.State.StartedAt}} restarts={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}'
    done
    echo "## redes"; docker network ls --format '{{.Name}}' | grep -v '^salvionix-crm_' | sort
    echo "## volúmenes"; docker volume ls --format '{{.Name}}' | grep -v '^salvionix-crm_' | sort
    echo "## miembros de la red de n8n"
    docker network inspect "$N8N_NET" --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' | grep -v '^salvionix-crm-' | sort
  } > "$f"
  echo "guardado en $f"
}
export N8N_NET=NOMBRE_DE_LA_RED        # la misma de la sección a
```

- **Antes** (al final de la sección a): `snap antes`.
- **Después** (al terminar la sección c y otra vez al final de las pruebas): `snap despues` y `diff ~/snap-antes.txt ~/snap-despues.txt && echo "IGUAL"`. La salida de `diff` debe estar vacía. Si `started=` o `restarts=` de n8n o WAHA cambió, algo los reinició: para y avisa.
- **Además, a ojo:** abrir n8n y comprobar que Javier v4 sigue **activo** y que sus ejecuciones recientes no cambiaron; que WAHA muestra sus sesiones en el mismo estado (sin entrar a ellas más de lo necesario); y `docker stats --no-stream` de n8n y WAHA antes y después, para ver que no se quedaron sin memoria.
- Si n8n responde por el puerto publicado: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:PUERTO_N8N/healthz` (200 antes y después).

## f) Ver el panel desde el PC con túnel SSH

El panel solo escucha en `127.0.0.1` del VPS. Desde el PC (PowerShell):

```powershell
ssh -N -L 18088:127.0.0.1:8088 USUARIO@VPS
```

Déjalo abierto y entra en **http://localhost:18088/**. Si cambiaste `PANEL_PORT`, usa ese puerto después de `127.0.0.1:`. Cierra el túnel con Ctrl+C. No hay que abrir ningún puerto del VPS ni tocar el cortafuegos.

- El panel entra solo, como la responsable de ejemplo «Sebastián (demo)» (no hay inicio de sesión: ver la advertencia 2 de la sección 0).
- Con el modo presentación, el panel se refresca solo cada pocos segundos: se ve llegar la conversación de la copia de Javier sin recargar.
- Si el navegador avisa de un error al registrar el service worker, no afecta al panel.

## g) Borrar los registros de prueba

`clean-test-data.sql` vacía lo que crean los clientes y el bot (contactos, oportunidades, empresas, notas, tareas, conversaciones, mensajes, outbox, cotizaciones, citas, documentos y sus registros de archivo) y **deja la configuración** (marca, canal, lista de precios, técnicos y su disponibilidad, responsables). Es la misma lista que `db-seed-presentacion --reset`. También reinicia la numeración de la serie de **prueba** (`PRUEBA-COT`, `PRUEBA-OC`, `PRUEBA-OT`); la serie real no se toca.

```bash
cd ~/salvionix-crm

# 1. Registros (la última salida debe mostrar todo en 0 y la configuración con sus filas)
docker compose exec -T db psql -U postgres -d salvionix -v ON_ERROR_STOP=1 < clean-test-data.sql

# 2. Archivos PDF de los documentos (el SQL no los borra: viven en el volumen de documentos)
docker compose exec -T core-api sh -c 'find /data/documents -type f -delete; echo "PDF restantes: $(find /data/documents -type f | wc -l)"'
```

(`psql` entra como `postgres` por el socket del contenedor, sin contraseña.) Para volver a cargar los datos ficticios de la presentación después: `docker compose run --rm migrate node scripts/db-seed-presentacion.ts`.

## h) Apagar y eliminar todo (rollback completo)

Deja el VPS como estaba. Solo afecta al proyecto `salvionix-crm` y a las dos imágenes con ese nombre. **n8n y WAHA no se tocan.**

```bash
cd ~/salvionix-crm

# 1. Contenedores, redes del proyecto y volúmenes (base de datos y PDF). Irreversible: es el fin de los datos de prueba.
docker compose --profile pdf down -v --remove-orphans

# 2. Imágenes del proyecto. NO uses --rmi all: borraría postgres y otras imágenes que pueden usar otros contenedores.
docker rmi salvionix-crm/core-api:test salvionix-crm/panel:test

# 3. Imágenes públicas que se bajaron SOLO para este stack. Antes mira que ningún otro contenedor las use:
docker ps -a --format '{{.Names}}  {{.Image}}'
#    Si nadie usa postgres:17.10, postgrest/postgrest:v16.4 o gotenberg/gotenberg:8.38.1, bórralas con docker rmi.
#    Si no estás seguro, déjalas: no estorban.

# 4. Archivos del paquete, el .env y los .tar si los hubo
cd ~ && rm -rf ~/salvionix-crm ~/crm-imagenes.tar

# 5. Comprobar: no debe quedar nada del proyecto
docker compose ls; docker volume ls | grep salvionix-crm; docker network ls | grep salvionix-crm; docker images | grep salvionix-crm
```

Luego `snap despues` y `diff` contra `snap antes` (sección e): sin diferencias. Falta solo la parte de n8n: **borrar la copia de pruebas de Javier v4** (y con ella el secreto de pruebas que se pegó en sus nodos) desde la interfaz de n8n. En el PC, el túnel SSH se cierra con Ctrl+C.

Si algo sale mal a mitad del despliegue: el paso 1 de arriba también sirve (borra lo que exista, aunque esté incompleto). Si el nombre de la red de n8n estaba mal y `docker compose` se queja, edita `N8N_DOCKER_NETWORK` en el `.env` y repite; `down` necesita esa variable aunque no haya llegado a conectarse.

## Qué se probó en local (PC, sin VPS)

Con una red de prueba que simula la de n8n (`N8N_DOCKER_NETWORK=n8n-sim`) y un `.env` temporal fuera del repositorio:

- Las dos imágenes construyen (core-api 288 MB; panel 100 MB, con el bundle de producción de React).
- `docker compose up -d` deja `migrate` en `Exited (0)` tras aplicar las 17 migraciones, y db, PostgREST, `core-api`, gateway y panel arriba.
- **Puerta estricta, desde un contenedor de la red simulada de n8n** (con un n8n y un WAHA de mentira en esa red): `http://salvionix-core-api:8080/healthz` responde 200; `/tools/ficha` y `/tools/cotizar` con token inválido o sin token responden `401` (llegan a `core-api`); `POST /hooks/whatsapp` sin firma responde `400` (también de `core-api`). **`/admin/session`, `/admin/rest/contacts`, `/admin/documents`, `/admin/agenda/technicians`, `/` y los intentos con `..` responden `403`**, y `GET /hooks/whatsapp` (método no permitido) también. `salvionix-core-api:3000` rechaza la conexión, y `core-api`, `db` y `postgrest` no se alcanzan desde esa red.
- **Camino completo con la puerta:** `send-test-message.mjs` → `core-api` → el webhook llegó al n8n de mentira por `gateway:8081` con su firma → con el token de ese webhook, `POST /tools/responder` por `salvionix-core-api:8080` respondió 200 → el outbox entregó `POST /api/sendText` al WAHA de mentira por `gateway:8082`.
- Panel en `127.0.0.1:8088` (200, relleno SPA, `/admin/session` pasa por nginx y responde 200: el panel sí llega a `/admin`). Puertos publicados: solo el del panel, en `127.0.0.1`.
- El flujo completo de 4 pasos (cliente nuevo, ficha, cotización con PDF vía Gotenberg, escalado) contra ese stack. `clean-test-data.sql` lo dejó todo en 0 y la configuración intacta; los PDF se borran con el segundo comando de la sección g.
- Después: `docker compose down -v`, imágenes, contenedores falsos y red de prueba eliminados, y la base local `salvionix-local_db-data` con la misma huella de antes.

Pendiente de confirmar el lunes en el VPS: nombre de la red de n8n, nombre del contenedor de n8n y su puerto, ruta del webhook de la copia de Javier v4, si el nodo de n8n puede leer `$env` (o se usa el secreto de pruebas en los nodos), y si se activa el PDF.