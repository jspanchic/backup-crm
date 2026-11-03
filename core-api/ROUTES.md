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
| POST | `/tools/confirmar_titular` | Bot | Token. Solo mientras haya una verificación pendiente (más de 90 días de silencio). Si es otra persona, abre un contacto y una conversación nuevos |
| POST | `/tools/responder` | Bot | Token. El texto se revisa contra la base antes de encolarlo |
| GET | `/admin/session` | Panel | Solo con `ADMIN_DEV_SUB`. Devuelve nombre, id y si es administrador del usuario del panel; nada más |
| POST | `/admin/agenda/appointments` | Panel | Solo con `ADMIN_DEV_SUB`. Esquema estricto. Reserva un horario (hold) para una oportunidad, o lo confirma en el mismo paso. Sin cruces, dentro de la disponibilidad del técnico, una reserva a la vez por marca (reglas en la base, `api.staff_book`) |
| POST | `/admin/agenda/appointments/:id/confirm` | Panel | Solo con `ADMIN_DEV_SUB`. Exige hold vigente, dirección y cotización enviada |
| POST | `/admin/agenda/appointments/:id/cancel` | Panel | Solo con `ADMIN_DEV_SUB`. Libera el horario |
| POST | `/admin/agenda/appointments/:id/reschedule` | Panel | Solo con `ADMIN_DEV_SUB`. Cancela y reserva en una transacción: si el nuevo horario está ocupado no cambia nada |
| POST | `/admin/agenda/technicians/:id/availability` | Panel | Solo con `ADMIN_DEV_SUB`. Reemplaza las ventanas semanales; no toca las citas ya reservadas y avisa cuántas quedan fuera |
| POST | `/admin/agenda/technicians/:id/time-off` | Panel | Solo con `ADMIN_DEV_SUB`. Agrega una ausencia y avisa cuántas citas cubre |
| DELETE | `/admin/agenda/time-off/:id` | Panel | Solo con `ADMIN_DEV_SUB`. Quita una ausencia |
| GET, POST, PATCH, DELETE | `/admin/rest/*` | Panel | Solo con `ADMIN_DEV_SUB` (desarrollo). Lista cerrada de recursos y métodos (`ADMIN_RESOURCES`; `conversation_messages` y `appointments_summary` son solo lectura). Del encabezado `Accept` solo pasa `application/json` y `application/vnd.pgrst.object+json` (el `getOne` del panel). Producción: Cloudflare Access (CRM-T3) |

Todas las rutas `/tools/*`: cuerpo de máximo 16 KB; con la conversación pausada responden `409 bot_paused` (menos `ficha`).

