# Rutas de core-api

**Si una ruta no está en esta lista, no existe** (responde 404). Una prueba compara esta tabla con las rutas
registradas: agregar una ruta sin documentarla la hace fallar.

| Método | Ruta | Quién | Protección |
|---|---|---|---|
| GET | `/healthz` | Local | Sin datos |
| POST | `/hooks/whatsapp` | WAHA, solo red interna | HMAC-SHA512 sobre el cuerpo crudo, comparación en tiempo constante, timestamp de máximo 5 min. Duplicados descartados por `payload.id` |
| GET, POST, PATCH, DELETE | `/admin/rest/*` | Panel | Solo con `ADMIN_DEV_SUB` (desarrollo). Lista cerrada de recursos y métodos. Producción: Cloudflare Access (CRM-T3) |

Las rutas `/tools/*` llegan con CRM-T6.
