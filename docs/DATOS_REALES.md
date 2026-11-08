# Cómo reemplazar los datos de ejemplo por los reales

Hoy el CRM de la presentación corre con **datos de ejemplo**: nada de esto es real todavía. Esta guía dice dónde vive cada dato de ejemplo, cómo cambiarlo y qué afecta. Los datos de ejemplo nunca se mezclan con los reales: los clientes de prueba están marcados `is_test` y sus documentos salen con la serie `PRUEBA-*`.

| Dato | Valor de ejemplo | Dónde se cambia | Afecta a |
|---|---|---|---|
| Aplicadores y días libres | «Aplicador de ejemplo (Orlando)»; fines de semana de 10:00 a 19:00; miércoles y jueves de 09:00 a 22:00 | `db/seeds/aplicadores.jsonc`, o el panel (Agenda → Disponibilidad) | Los horarios que ofrece Javier y los que se pueden agendar en el calendario |
| Duración del servicio y traslado | 60 min y 30 min | `db/seeds/aplicadores.jsonc` | El largo de cada horario y cada cuánto se ofrece uno |
| Impuesto | 6,5 % | `core.brands.tax_pct` (SQL) | Cotizaciones **nuevas**: PDF, total, monto del negocio y mensaje de Javier |
| Descuento | Activo (7 % de la lista de precios) | `core.brands.discount_enabled` (SQL) | Cotizaciones **nuevas** |
| Precios y porcentaje del descuento | Lista de ejemplo, «por confirmar» | Una **nueva versión** de `core.price_lists` | Cotizaciones nuevas |
| Textos legales y datos de la empresa | `[POR CONFIRMAR]` | `core-api/templates/settings.json` | Todos los PDF (ver `docs/PLANTILLAS_PDF.md`) |

## 1. Aplicadores, días libres, servicio y traslado

### Opción A: editar el archivo

`db/seeds/aplicadores.jsonc` es **el único lugar** de donde sale la disponibilidad de la presentación. Está comentado línea por línea. Tiene:

- `servicio_minutos` y `traslado_minutos`.
- La lista de `aplicadores`; cada uno con su `nombre` y sus franjas de `disponibilidad`: días de la semana (`lunes` … `domingo`, sin tildes), `desde` y `hasta` en 24 h.

Solo atiende en las franjas que aparecen: un día que no está en la lista no tiene horarios. Para los días libres reales, deja entre semana únicamente esos días.

Para cargarlo, desde `core-api/`:

```powershell
npm run db:seed-presentacion
```

(o `INICIAR-PRESENTACION.cmd limpio`, que además vuelve a sembrar las citas de ejemplo desde el día de hoy). El script revisa el archivo y, si algo no cuadra (un día mal escrito, una franja cruzada), dice cuál y no cambia nada.

Qué afecta: reemplaza las franjas del aplicador y los minutos de servicio y traslado. **Las citas que ya existen no se mueven.** El margen de traslado de una cita queda guardado cuando se reserva: cambiarlo después no toca las citas viejas.

Si agregas más aplicadores, el primero de la lista es el id 1 (el de las citas de ejemplo) y los siguientes toman los ids 2, 3…

### Opción B: desde el panel

**Agenda → Disponibilidad** (elige al aplicador): se editan las franjas de cada día de la semana y se agregan **ausencias** (un día o un periodo concreto en que no atiende, por ejemplo una vacación). Se guarda en el momento y el cambio vale ya para los horarios que ofrece Javier. Es la vía para una base real, porque `db:seed-presentacion` solo sirve para la base de la presentación (se niega a correr en producción).

Desde el panel **no** se cambian los minutos de servicio ni de traslado: esos son de `aplicadores.jsonc`, o en una base real:

```sql
update core.scheduling_settings set slot_minutes = 60, buffer_minutes = 30 where brand_id = 1;
```

## 2. Impuesto y descuento

Son de la **marca** y cada cotización los congela al crearse (migración 0018). Cambiarlos no toca las cotizaciones ni los documentos ya emitidos, y el total lo sigue calculando la base: ahora **incluye el impuesto**, que se calcula sobre el monto después del descuento y del mínimo.

En la base local de la presentación (desde la raíz del repositorio):

```powershell
docker compose -p salvionix-presentacion -f infra/local/docker-compose.yml --env-file infra/local/.env exec -T db psql -U postgres -d salvionix -c "update core.brands set tax_pct = 7, discount_enabled = false where id = 1"
```

En el VPS de pruebas: `docker compose exec -T db psql -U postgres -d salvionix -c "update core.brands set tax_pct = 7 where id = 1"` desde `~/salvionix-crm`.

- `tax_pct`: porcentaje, de 0 a 100. Con 0 el PDF muestra «Impuesto (0%) $0.00».
- `discount_enabled`: `true` o `false`. Apagado, la cotización no descuenta y el PDF **no imprime** la fila del descuento.
- La semilla de la presentación (`db/seeds/presentation/02_brand_pricing.sql`) vuelve a poner 6,5 % y descuento activo cada vez que se carga: si cambias los valores en la base de la presentación, cambia también ese archivo.
- `cotizar` devuelve `descuento_aplicado`, `impuesto` e `impuesto_pct`; el bot debe mencionar el descuento solo si `descuento_aplicado` es `true`.

## 3. Lo demás que sigue siendo de ejemplo

- **Lista de precios:** los precios son una lista de ejemplo marcada «por confirmar». Los precios no se editan: se crea una **versión nueva** en `core.price_lists` (las versiones anteriores y sus cotizaciones quedan intactas).
- **Textos legales y datos de la empresa:** `core-api/templates/settings.json`. Mientras digan `[POR CONFIRMAR]`, a los clientes reales no se les emite ni se les envía ningún PDF (`confirmed: false`).
- **Responsable de las cuentas, canal de WhatsApp y marca:** los crea la semilla de ejemplo (`db/seeds/sample/`); la cuenta real se crea en el panel.
- **Numeración de documentos:** la serie real (`COT`, `OC`, `OT`) empieza donde se indique en `core.document_counters`; la de prueba (`PRUEBA-*`) se reinicia con cada `limpio`.