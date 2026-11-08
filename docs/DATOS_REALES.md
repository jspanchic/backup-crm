# Cómo reemplazar los datos de ejemplo por los reales

Hoy el CRM de la presentación corre con **datos de ejemplo**: nada de esto es real todavía. Esta guía dice dónde vive cada dato de ejemplo, cómo cambiarlo y qué afecta. Los datos de ejemplo nunca se mezclan con los reales: los clientes de prueba están marcados `is_test` y sus documentos salen con la serie `PRUEBA-*`.

| Dato | Valor de ejemplo | Dónde se cambia | Afecta a |
|---|---|---|---|
| Aplicadores y días libres | «Aplicador de ejemplo (Orlando)»; fines de semana de 10:00 a 19:00; miércoles y jueves de 09:00 a 22:00 | `db/seeds/aplicadores.jsonc`, o el panel (Agenda → Disponibilidad) | Los horarios que ofrece Javier y los que se pueden agendar en el calendario |
| Duración del servicio y traslado | 60 min y 30 min | `db/seeds/aplicadores.jsonc` | El largo de cada horario y cada cuánto se ofrece uno |
| Impuesto | 6,5 % | `core.brands.tax_pct` (SQL) | Cotizaciones **nuevas**: PDF, total, monto del negocio y mensaje de Javier |
| Descuento | Activo (7 % de la lista de precios) | `core.brands.discount_enabled` (SQL) | Cotizaciones **nuevas** |
| Precios y porcentaje del descuento | Lista de ejemplo, «por confirmar» | Una **nueva versión** de `core.price_lists` | Cotizaciones nuevas |
| Textos del PDF y datos de la empresa | Provisionales, con `confirmed: true` | `core-api/templates/settings.json` | Todos los PDF (ver `docs/PLANTILLAS_PDF.md`) |
| Envío de PDF a clientes reales | Apagado | `core.brands.pdf_clientes_reales` (SQL) | Envíos por WhatsApp desde el bot y el panel |

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

- `tax_pct`: porcentaje, de 0 a 100. Con 0 el PDF omite la fila de impuesto.
- `discount_enabled`: `true` o `false`. Apagado, la cotización no descuenta y el PDF **no imprime** la fila del descuento.
- La semilla de la presentación (`db/seeds/presentation/02_brand_pricing.sql`) vuelve a poner 6,5 % y descuento activo cada vez que se carga: si cambias los valores en la base de la presentación, cambia también ese archivo.
- `cotizar` devuelve `descuento_aplicado`, `impuesto` e `impuesto_pct`; el bot debe mencionar el descuento solo si `descuento_aplicado` es `true`.

## 3. Lo demás que sigue siendo de ejemplo

- **Lista de precios:** la presentación usa una lista de ejemplo marcada «por confirmar». Para la lista de producción, usa el importador de la sección siguiente.
- **Textos y datos de la empresa.** `core-api/templates/settings.json` contiene el contacto, las formas de pago y la frase de garantía de Javier v4. El archivo queda en `confirmed: true` y el envío a clientes reales sigue apagado por marca.
- **Responsable de las cuentas, canal de WhatsApp y marca:** los crea la semilla de ejemplo (`db/seeds/sample/`); la cuenta real se crea en el panel.
- **Numeración de documentos:** la serie real (`COT`, `OC`, `OT`) empieza donde se indique en `core.document_counters`; la de prueba (`PRUEBA-*`) se reinicia con cada `limpio`.

## 4. Archivo de precios de producción

La versión 2 de producción incorpora los factores de Javier v4 en [precios-salvionix.json](../infra/vps/precios-salvionix.json). Edita allí los valores de la marca. Para cargar un cambio, sube `version` a un número mayor. Usa números JSON con punto decimal.

| Campo | Qué controla |
|---|---|
| `covered_rate`, `uncovered_rate` | Tarifas en USD por pie cuadrado cubierto y descubierto, con hasta cuatro decimales |
| `discount_pct`, `min_total` | Descuento porcentual en escala 0 a 100 y mínimo en USD, con hasta dos decimales |
| `tax_pct` | El importador verifica que la marca esté configurada con el impuesto aprobado de 0% |
| `rounding` | `salvionix_v4` suma y redondea hacia abajo el metraje cubierto y el descubierto por separado. Redondea el subtotal al dólar más cercano, aplica el porcentaje al subtotal redondeado y redondea el descuento al dólar más cercano. En ambos importes, medio dólar sube. El total es subtotal menos descuento y luego se aplica el mínimo. |
| `home_base_sqft`, `home_bedroom_sqft` | Pies cuadrados base de una casa y adicional por habitación |
| `parking_first_car_sqft`, `parking_extra_car_sqft` | Pies cuadrados por el primer auto y por cada auto adicional. Se usan los mismos factores en estacionamientos cubiertos y descubiertos. |
| `sqm_to_sqft`, `pace_to_ft` | Conversión de metros cuadrados a pies cuadrados y de pasos a pies |
| `area_factors_provisional` | `false` en la versión 2, que usa los factores de Javier v4. |
| `controls` | Seis casos con resultados esperados. Los controles aceptan metraje directo o `inputs` con dormitorios, estacionamientos y áreas adicionales para un hogar. Recalcula sus importes y revisa cuándo se aplica el mínimo al cambiar la tarifa o la fórmula. |

Sigue el comando de [CORTE_LUNES.md](CORTE_LUNES.md). El importador activa la lista y cierra la anterior en una sola transacción cuando PostgreSQL verifica el metraje y los importes. La lista de producción debe devolver `6 controls passed`.

| Caso | Pies² cubiertos | Pies² descubiertos | Subtotal | Descuento | Total | Aplica mínimo |
|---|---:|---:|---:|---:|---:|---|
| Metraje directo | 1.731 | 0 | $208 | $15 | $193 | No |
| Metraje directo | 8.000 | 3.000 | $1.140 | $80 | $1.060 | No |
| Servicio mínimo | 1.000 | 0 | $120 | $8 | $150 | Sí |
| Hogar con 3 dormitorios, 2 autos techados, 240 pies² techados y 2.000 pies² descubiertos adicionales | 2.100 | 2.000 | $372 | $26 | $346 | No |
| Metraje directo | 1.501 | 0 | $180 | $13 | $167 | No |
| Metraje directo | 1.546 | 0 | $186 | $13 | $173 | No |

Repetir el archivo activo con las mismas reglas devuelve `already active`. Las cotizaciones emitidas conservan su lista y sus importes.

## 5. Envío de PDF a clientes reales

`core.brands.pdf_clientes_reales` queda en `false` por defecto. Para enviar PDF por WhatsApp a clientes reales se requiere activarlo en la marca y confirmar los textos legales en `core-api/templates/settings.json`. El interruptor se aplica al bot y a los envíos manuales en entornos con permisos de escritura. El panel de producción permite consultar y descargar los PDF existentes. Los envíos a clientes marcados de prueba siguen disponibles.

Consulta el estado y, cuando corresponda habilitarlo, ejecuta el `UPDATE` con la función `sql` del [procedimiento de corte](CORTE_LUNES.md).

```sql
SELECT slug, pdf_clientes_reales FROM core.brands WHERE slug = 'salvionix';

UPDATE core.brands SET pdf_clientes_reales = true
WHERE slug = 'salvionix' RETURNING slug, pdf_clientes_reales;
```

Para apagarlo usa `false` en el `UPDATE`. Al apagarlo, se cancelan los PDF para clientes reales que todavía esperan envío. Los envíos cancelados se pueden volver a solicitar manualmente después de habilitarlo. Si ya se había autorizado una llamada a WAHA, puede completar ese intento. Con el interruptor apagado y los textos legales confirmados, el bot puede seguir preparando las órdenes de trabajo internas.
