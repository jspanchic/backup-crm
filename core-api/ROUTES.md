# Rutas de core-api

**Si una ruta no está en esta lista, no existe** (responde 404). Una prueba compara esta tabla con las rutas
registradas: agregar una ruta sin documentarla la hace fallar.

| Método | Ruta | Quién | Protección |
|---|---|---|---|
| GET | `/healthz` | Local | Sin datos |
| POST | `/hooks/whatsapp` | WAHA, solo red interna | HMAC-SHA512 sobre el cuerpo crudo, comparación en tiempo constante, timestamp de máximo 5 min. Duplicados descartados por `payload.id` |
| GET | `/tools/ficha` | Bot (n8n), solo red interna | Token de conversación de 15 min. Sin parámetros |
| POST | `/tools/guardar_datos` | Bot | Token. Esquema estricto: un campo de más, incluido cualquier id, da 400 |
| POST | `/tools/cotizar` | Bot | Token. Esquema estricto. No acepta montos: los calcula la base |
| POST | `/tools/escalar` | Bot | Token. Esquema estricto. Pausa el bot |
| POST | `/tools/horarios_libres` | Bot | Token. Registra lo que muestra: solo esos horarios se pueden reservar o mencionar |
| POST | `/tools/reservar` | Bot | Token. Solo un horario ofrecido en esta conversación. Reserva provisional de 15 min |
| POST | `/tools/confirmar` | Bot | Token. Sin campos. Exige hold vigente, dirección y cotización. Envía el mensaje de confirmación |
| POST | `/tools/responder` | Bot | Token. El texto se revisa contra la base antes de encolarlo |
| GET, POST, PATCH, DELETE | `/admin/rest/*` | Panel | Solo con `ADMIN_DEV_SUB` (desarrollo). Lista cerrada de recursos y métodos. Producción: Cloudflare Access (CRM-T3) |

Todas las rutas `/tools/*`: cuerpo de máximo 16 KB; con la conversación pausada responden `409 bot_paused` (menos `ficha`).

Falta `confirmar_titular` (CRM-T10).
