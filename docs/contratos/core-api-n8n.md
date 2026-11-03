# Contrato HTTP entre core-api y el bot (n8n)

Versión del contrato: **1**. Estado: implementado en `core-api/src/bot.ts` y probado en `core-api/test/webhook.test.ts`. Las herramientas (`/tools/*`) llegan con CRM-T6.

## 1. Mensaje de core-api al bot

`core-api` llama al bot **después de responder 200 a WAHA**. La URL sale de la variable `BOT_URL_<BOT_KEY>` (por ejemplo `BOT_URL_JAVIER`), nunca de la base ni del mensaje.

```text
POST <BOT_URL_JAVIER>
Content-Type: application/json
X-Core-Timestamp: 1893456000
X-Core-Signature: <HMAC-SHA256 hexadecimal de "<timestamp>.<cuerpo crudo>">
```

```json
{
  "token": "<JWT HS256, 15 minutos>",
  "tenant": "salvionix",
  "bot": "javier",
  "canal": "whatsapp",
  "mensaje": { "id": "msg_1234", "texto": "Hola, quiero cotizar" },
  "contacto": {
    "nombre": "Carlos",
    "nuevo": false,
    "reverificar": false,
    "telefono_enmascarado": "+1••••••0123",
    "idioma": null
  },
  "historial": [
    { "de": "cliente", "texto": "Hola" },
    { "de": "bot", "texto": "Hola, soy Javier" }
  ],
  "ficha": {
    "etapa": "opportunity",
    "zip": null,
    "cotizacion_vigente": null,
    "cita": null
  }
}
```

| Campo | Detalle |
|---|---|
| `token` | Se manda en el cuerpo para que n8n lo ponga en `Authorization: Bearer` de cada herramienta. Ver sección 3 |
| `tenant`, `bot`, `canal` | Marca, bot y canal. Salen de la configuración del canal en la base |
| `mensaje.id` | Id propio de core-api (`msg_<n>`). **No es el id de WAHA**, porque ese lleva el teléfono del cliente |
| `mensaje.texto` | Ya con las tarjetas redactadas (`[TARJETA REDACTADA]`) |
| `contacto.nombre` | `null` si el cliente aún no dio su nombre. Hasta entonces el contacto se llama "WhatsApp" internamente |
| `contacto.nuevo` | `true` si es el primer mensaje de la conversación |
| `contacto.reverificar` | `true` si pasaron más de `reverify_after_days` (90 de ejemplo) entre este mensaje y el anterior: el bot debe confirmar el nombre antes de usar datos viejos, por si el número cambió de dueño |
| `contacto.telefono_enmascarado` | Solo el prefijo y los 4 últimos dígitos. **El teléfono completo no viaja a n8n** (`[ARQ]`:123). `null` si el cliente solo tiene un `@lid` |
| `historial` | Hasta 40 mensajes anteriores, del más viejo al más nuevo, sin el actual. `de`: `cliente`, `bot` o `humano` |
| `ficha.etapa` | Etapa de la oportunidad abierta (`opportunity`, `contacted`, ...) |
| `ficha.cotizacion_vigente` | `{version, total, currency, price_confirmed}` o `null`. **Los montos que diga el bot deben venir de aquí o de `/tools/cotizar`, nunca del modelo** |
| `ficha.cita` | `{start_at, end_at, status, address}` de la cita `hold` o `confirmed`, o `null` |

**Lo que no viaja:** ids de cliente, de contacto, de marca ni de conversación (solo dentro del token firmado), el teléfono completo, el id de WAHA, ni las claves.

## 2. Respuesta del bot

- **Debe responder `2xx` sin cuerpo** apenas reciba el mensaje (dentro de 10 s). La respuesta al cliente **no** va en la respuesta HTTP: el bot la manda llamando a `/tools/responder`.
- Cualquier otro resultado (error, 4xx, 5xx, tiempo agotado) deja el mensaje sin marcar y **core-api lo reintenta cada 30 segundos** durante 24 horas. Por eso el bot debe tolerar que le llegue dos veces el mismo `mensaje.id`.
- Si la conversación está pausada (`escalar`), core-api guarda el mensaje y **no llama al bot**.

## 3. Cómo verifica n8n que el mensaje es de core-api

1. Leer el cuerpo **crudo** (sin parsear ni reformatear).
2. Calcular `HMAC-SHA256(BOT_HMAC_SECRET, X-Core-Timestamp + "." + cuerpo)` en hexadecimal.
3. Compararlo con `X-Core-Signature`.
4. Rechazar si `X-Core-Timestamp` (segundos) difiere más de 5 minutos del reloj.

**Desvío respecto a `[ARQ]`:128-130**, que firmaba solo el cuerpo: aquí la firma incluye el timestamp, así que un mensaje capturado no se puede reenviar más tarde con otro. En n8n se hace con el nodo Code y `crypto`.

## 4. El token de conversación

JWT HS256, firmado con `CONVERSATION_TOKEN_SECRET` (distinta de la de PostgREST y la del bot).

| Claim | Valor |
|---|---|
| `iss` | `core-api` |
| `aud` | `bot-tools` |
| `brd` | id de la marca |
| `cnv` | id de la conversación |
| `iat`, `exp` | emisión y vencimiento: **15 minutos** |
| `jti` | id único |

- **No lleva datos del cliente.** Las herramientas toman el contacto de la conversación, y ninguna recibe un id de cliente.
- n8n lo usa tal cual en `Authorization: Bearer <token>` hacia `core-api`. **No lo genera ni lo cambia el modelo**: el valor sale del webhook de entrada.
- Si el número se reasigna a otra persona, el token viejo sigue siendo válido hasta su vencimiento pero `core-api` actúa sobre la conversación nueva (`superseded_by`, CRM-T10): no toca datos del dueño anterior.

## 5. Variables

| Variable | Quién la tiene | Para qué |
|---|---|---|
| `BOT_URL_<BOT_KEY>` | core-api | Dónde llamar al bot |
| `BOT_HMAC_SECRET` | core-api y n8n | Firma core-api → bot |
| `CONVERSATION_TOKEN_SECRET` | **solo core-api** | n8n no la necesita: solo reenvía el token |
| `WAHA_HMAC_<CANAL>` | core-api y WAHA | Firma WAHA → core-api. El nombre de la variable está en `core.channels.secret_ref` |

## 6. Mensaje de WAHA a core-api (resumen)

Detalle en `docs/plan/ENTREGA_1.md`, sección 7.2. Es un **SUPUESTO hasta tener una captura real**: formato de `payload.id`, codificación de la firma (hexadecimal) y unidad de `payload.timestamp`.

```text
POST /hooks/whatsapp
X-Webhook-Hmac: <HMAC-SHA512 hexadecimal del cuerpo crudo>
X-Webhook-Hmac-Algorithm: sha512
X-Webhook-Timestamp: <milisegundos>
```

La firma no cubre el timestamp. La protección contra repetición es el descarte de duplicados por `payload.id` y canal.

## 7. Para conectar n8n

1. Crear en n8n un Webhook que reciba el `POST` de la sección 1 y responda 200 enseguida.
2. Verificar la firma (sección 3) en un nodo Code.
3. Pasar `token` a las herramientas como `Authorization: Bearer`.
4. Terminar con `POST /tools/responder` (CRM-T6). El flujo no escribe a WAHA.
5. Poner `BOT_URL_JAVIER` en la URL de producción del Webhook y `BOT_HMAC_SECRET` en el entorno de n8n, nunca en el flujo exportado.
