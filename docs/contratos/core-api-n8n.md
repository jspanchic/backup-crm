# Contrato HTTP entre core-api y el bot (n8n)

Versión del contrato: **1**. Estado: implementado en `core-api/src/bot.ts` y probado en `core-api/test/webhook.test.ts`. Las herramientas están en la sección 4b (CRM-T6; faltan las de agenda, que llegan con CRM-T9 y CRM-T10).

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

## 4b. Herramientas del bot

Todas con `Authorization: Bearer <token>`, **cuerpo JSON de máximo 16 KB y esquema estricto**: un campo de más, incluido cualquier id de cliente, da `400`. Ninguna recibe un id: el contacto sale del token.

| Código | Cuándo |
|---|---|
| `401 invalid_token` | Sin token, vencido, firma o marca incorrecta, conversación inexistente |
| `409 conversation_closed` | La conversación se cerró y no tiene sucesora |
| `409 bot_paused` | La conversación está pausada (`escalar`). Solo `ficha` sigue respondiendo |
| `400 invalid_input` | Esquema o validación. Trae `fields` o un `message` para el modelo |
| `409 invalid_state` | No hay oportunidad abierta, etc. |
| `422 reply_rejected` | `responder`: el texto no pasó la revisión. Trae `reason` y `message` para corregir |

| Ruta | Entrada | Devuelve |
|---|---|---|
| `GET /tools/ficha` | Nada (ni query) | `nombre`, `apellido`, `email`, `idioma`, `telefono_enmascarado`, `etapa`, `tipo_cliente`, `tipo_espacio`, `direccion`, `tamano`, `zip`, `cotizacion_vigente`, `cita` |
| `POST /tools/guardar_datos` | Al menos uno de: `nombre`, `apellido`, `email`, `idioma` (`es`\|`en`), `tipo_cliente` (`hogar`\|`empresa`), `tipo_espacio`, `direccion`, `tamano`, `zip` | `{guardado: [...]}`. Con nombre y tipo de cliente, la oportunidad pasa a `contacted` |
| `POST /tools/cotizar` | `tipo_cliente`; hogar: `dormitorios`, `autos_techados`, `autos_descubiertos`; empresa: `pies_cubiertos`; ambos: `areas_extra[]` con `techada` (obligatorio, nunca se asume) y `pies`, `metros` o `pasos_largo`+`pasos_ancho` | `version`, `subtotal`, `descuento`, `total`, `minimo_aplicado`, `pies_cubiertos`, `pies_descubiertos`, `moneda`, `descuento_pct`, `descuento_aplicado`, `impuesto`, `impuesto_pct`, `precios_confirmados`. **`total` ya incluye el impuesto** (la tasa y el interruptor del descuento son de la marca: `core.brands.tax_pct` y `discount_enabled`); si `descuento_aplicado` es `false` no menciones descuento. **No acepta montos**. Además `pdf` (`en_cola` o `no_disponible`) y `aviso_pdf`: `core-api` emite la cotización en PDF y la pone en cola para enviarse por WhatsApp. **Solo di que va el PDF si `pdf` es `en_cola`** (ver "Documentos en PDF") |
| `POST /tools/escalar` | `motivo` (1 a 300) | `{pausado, ya_estaba_pausado}`. Pausa el bot y crea una tarea de seguimiento |
| `POST /tools/horarios_libres` | `desde` (fecha, opcional), `dias` (1 a 14, opcional). Cuerpo vacío = próximos 7 días | `zona_horaria` y hasta 12 `horarios` con `inicio`, `fin` y `texto` ya escrito en el idioma del cliente. **Solo estos horarios se pueden reservar o mencionar** |
| `POST /tools/reservar` | `inicio` (fecha y hora con zona, tal cual la devolvió `horarios_libres`) | `inicio`, `fin`, `vence_en` (15 min). `409 slot_not_offered` si no salió de `horarios_libres`; `409 slot_taken` si ya no está libre |
| `POST /tools/confirmar` | Nada (`{}` o vacío) | `{confirmado, inicio, fin, mensaje_enviado}`. Exige hold vigente (`409 hold_expired` si venció), dirección y cotización. **El mensaje de confirmación lo escribe `core-api` y ya se envió: el bot no debe escribir otro**. Además `pdf` y `aviso_pdf`, como en `cotizar`, para la orden de compra |
| `POST /tools/responder` | `texto` (1 a 4000) | `{encolado, id}` o `422` |

**Marca del teléfono.** Si el bot necesita repetirle al cliente su celular, escribe `{{telefono}}`: `core-api` pone el número solo en el mensaje que sale. El historial que vuelve a n8n conserva la marca, así que el número completo no pasa nunca por el bot.


**Documentos en PDF (CRM-T14c).** El bot **no genera ni envía PDF**: no hay herramienta para eso. `core-api` lo hace solo, dentro de `cotizar` y `confirmar`, y le cuenta al bot qué pasó en `pdf` y `aviso_pdf`.

| Momento | Qué hace `core-api` | Al cliente | Al técnico |
|---|---|---|---|
| `cotizar` | Emite la cotización (numerada `COT-`) y su PDF | Se la envía por WhatsApp, con una frase corta | |
| `confirmar` | Emite la orden de compra (`OC-`) y la orden de trabajo (`OT-`) | Solo la orden de compra | La orden de trabajo queda emitida y guardada; no se envía a nadie |

Reglas para el bot:

- `pdf: "en_cola"` = el PDF quedó en cola de envío. Puede decirlo ("te envié la cotización en PDF"), **sin prometer a qué hora llega**.
- `pdf: "no_disponible"` = **no se envió ningún PDF**: no lo menciones ni lo prometas. Es lo que pasa también cuando el motor de PDF falla: la cotización o la cita **no se pierden**; alguien del equipo puede emitir el documento desde el panel.
- **Candado legal:** mientras los textos legales estén `[POR CONFIRMAR]` (`confirmed: false` en `core-api/templates/settings.json`), a un **cliente real** no se le emite ni se le envía nada solo, y `pdf` es siempre `no_disponible`. Los clientes de prueba (`Prueba …`) sí reciben los PDF. Sin cambios en el bot cuando el candado se abra: el mismo campo pasa a `en_cola`.
- Una nueva cotización (otra llamada a `cotizar`) emite y envía otra cotización.
- El PDF y su frase no pasan por `responder`: no se revisan con las reglas de arriba y no cuentan como respuesta del bot, pero quedan en el historial de la conversación como mensajes del bot.
- **n8n no necesita cambios de flujo:** solo leer `pdf` y `aviso_pdf` de la respuesta de las dos herramientas.
**Qué revisa `responder` antes de encolar** (código `reason`):

| `reason` | Se detiene cuando |
|---|---|
| `amount_not_from_quote` | Hay un monto (`$1,060`, `USD 150`, `150 dólares`) que no es de la cotización vigente ni una tarifa o el mínimo de la lista de precios |
| `confirmation_without_appointment` | Dice agendado, confirmado, scheduled, booked o confirmed sin una cita **confirmada** en la base (un hold no cuenta) |
| `time_mismatch`, `date_mismatch` | Con una cita confirmada, escribe una hora, fecha o día de la semana que no es el suyo (hora en la zona de la marca) |
| `url_not_allowed` | Enlace fuera de los dominios de la marca |
| `phone_in_reply` | Un número de 10 o más dígitos escrito a mano |
| `schedule_not_offered` | Escribe una hora (`10:30`, `3 pm`), o una fecha o día de la semana en una frase sobre el servicio, que no salió de `horarios_libres` en esta conversación (o no es la de su hold o cita). Una hora final solo vale junto con la inicial |
| `phone_unavailable` | Usa `{{telefono}}` y el cliente no tiene número |

**Límite honesto:** la revisión busca patrones en el texto. Puede dejar pasar un monto escrito en letras ("doscientos ocho") o una fecha dicha de otra forma, y puede frenar una frase legítima; en ese caso el modelo recibe el motivo y reintenta. La protección de fondo no depende de ella: los montos salen de la cotización que calcula la base, y una cita solo se confirma desde un hold vigente.

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
