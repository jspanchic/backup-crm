# Plantillas de los PDF

Cómo cambiar el diseño y los textos de la cotización, la orden de compra y la orden de trabajo **sin tocar código**.
Las plantillas de hoy son **provisionales**: sirven para probar el flujo. Los textos legales dicen `[POR CONFIRMAR]`.

## Qué archivo cambiar

Todo está en `core-api/templates/`:

| Archivo | Qué es |
|---|---|
| `quote.html` | La cotización |
| `purchase_order.html` | La orden de compra (el cliente la confirma) |
| `work_order.html` | La orden de trabajo (para el técnico) |
| `settings.json` | Los datos legales de la empresa, las condiciones, el mensaje que acompaña al PDF y el interruptor `confirmed` |

Cada plantilla es **una página HTML normal, con su CSS dentro** (`<style>`). Se puede abrir y editar con cualquier editor,
o reemplazar entera por el diseño de otra herramienta, siempre que quede en un solo archivo.

Los cambios se aplican al **siguiente documento que se emita**: no hay que reiniciar nada. Los documentos que ya se emitieron
**no cambian**: su PDF queda guardado tal como salió.

## Cómo poner un dato

Se escribe el nombre del campo entre dobles llaves: `{{customer.name}}`. Es la única regla del lenguaje: no hay condiciones ni bucles.

- El valor se pone ya **escapado** (un `<` en un nombre no rompe la página).
- Un campo que no existe, o un `{{` mal escrito, **detiene la emisión con un error** en vez de dejar un hueco en un documento para un cliente.
- Si un dato falta en la oportunidad, se imprime `—`.
- El texto de las condiciones respeta los saltos de línea (la clase `.terms` de las plantillas lo hace con `white-space: pre-line`).

## Tamaño de página y márgenes

Los decide el CSS de la plantilla, con la regla `@page`:

```css
@page { size: Letter; margin: 0.7in; }
```

Para A4: `size: A4`. Los colores de fondo se imprimen.

## Campos que existen

Son los **únicos** que se pueden usar. Salen de los datos congelados del documento (nunca de datos en vivo).

### Documento (`document.*`)

| Campo | Qué imprime |
|---|---|
| `document.number` | `COT-000501`, `OC-000012`, `OT-000012`. Los documentos de prueba usan `PRUEBA-COT-…`, `PRUEBA-OC-…`, `PRUEBA-OT-…` |
| `document.type` | `Cotización`, `Orden de compra` u `Orden de trabajo` |
| `document.issued_date` | Fecha de emisión, por ejemplo `1 de junio de 2030` (en la zona horaria de la marca) |
| `document.test_notice` | `DOCUMENTO DE PRUEBA — SIN VALOR` si el cliente es de prueba; vacío si es real. **Conviene dejarlo en la plantilla** |

### Marca y cliente

| Campo | Qué imprime |
|---|---|
| `brand.name` | Nombre de la marca |
| `customer.name` | Nombre y apellido del cliente |

### Servicio (`service.*`)

| Campo | Qué imprime |
|---|---|
| `service.space_type` | Tipo de espacio: `Hogar`, `Oficina o bodega`, `Restaurante o cocina`… |
| `service.address` | Dirección del servicio (la de la cita, si hay; si no, la de la oportunidad) |
| `service.space_size` | Tamaño del espacio, como lo dijo el cliente |

### Cita (`appointment.*`) — solo tiene datos en la orden de compra y la de trabajo

| Campo | Qué imprime |
|---|---|
| `appointment.date` | Día de la cita |
| `appointment.start_time` / `appointment.end_time` | Hora de inicio y de fin |
| `appointment.technician` | Nombre del técnico |

En la cotización estos campos imprimen `—`.

### Importe (`quote.*`)

Los montos **los calcula la base**; la plantilla solo los muestra.

| Campo | Qué imprime |
|---|---|
| `quote.version` | Versión de la cotización |
| `quote.valid_until` | Hasta cuándo es válida |
| `quote.valid_class` | Vacío si la cotización tiene fecha de validez; `hidden` si no (para ocultar esa línea con CSS) |
| `quote.covered_area` / `quote.uncovered_area` | Pies cuadrados cubiertos y descubiertos |
| `quote.total_area` | Metraje total (cubierto más descubierto), para el bloque destacado de la cotización |
| `quote.subtotal`, `quote.total` | Importes con moneda, por ejemplo `$221.07`. El total ya incluye el impuesto |
| `quote.discount` | El descuento como deducción, por ejemplo `-$15.62` |
| `quote.discount_class` | Vacío si el descuento se aplicó; `hidden` si la marca lo tenía apagado o no descontó nada (la plantilla no tiene condiciones: esa clase oculta la fila con CSS) |
| `quote.tax_label`, `quote.tax`, `quote.tax_class` | Tasa e importe del impuesto. Con tasa 0, `tax_class` oculta la fila |
| `quote.minimum_note` | `Se aplicó el cargo mínimo del servicio.` si corresponde; si no, vacío |
| `quote.price_note` | `Precios por confirmar.` mientras la lista de precios no esté confirmada; si no, vacío (la plantilla de la cotización ya no la imprime) |

**Impuesto y descuento por marca.** No son parte de la plantilla: viven en la marca (`core.brands.tax_pct` y `core.brands.discount_enabled`, migración 0018) y cada cotización los congela al crearse. Cambiarlos no toca cotizaciones ni documentos ya emitidos. Ejemplo:

```sql
update core.brands set tax_pct = 6.5, discount_enabled = false where id = 1;  -- impuesto 6,5 %, descuento apagado
```

La tasa de la semilla de la presentación (6,5 %) es un valor de ejemplo; `docs/DATOS_REALES.md` explica cómo cambiarla.
### Datos legales (`legal.*`) — los define `settings.json`

| Campo | Qué es |
|---|---|
| `legal.company_name`, `legal.tax_id`, `legal.address`, `legal.phone`, `legal.email`, `legal.license` | Datos de la empresa |
| `legal.payment_terms`, `legal.cancellation_policy` | Forma de pago y política de cancelación |
| `legal.quote_terms`, `legal.purchase_order_terms`, `legal.work_order_terms` | Condiciones de cada documento |
| `legal.customer_signature_label`, `legal.company_signature_label` | Rótulos de las firmas |

Para agregar un dato legal nuevo: ponerlo en `settings.json` dentro de `"legal"` (solo letras minúsculas, números y `_`) y usarlo como `{{legal.nombre}}`.

## Cómo probar una plantilla

1. Encender Gotenberg (viene con el resto: `npm run local:up` en `core-api`, o `INICIAR-DEMO.cmd`).
2. En `core-api`: `npm run docs:preview`.
3. Se generan `core-api/.data/preview/quote.pdf`, `purchase_order.pdf` y `work_order.pdf` con datos inventados. Si una plantilla tiene un error, el comando dice cuál y por qué.

Para probar una carpeta de plantillas fuera del repositorio: variable `TEMPLATES_DIR` (debe traer los tres `.html` y `settings.json`).

## Cuándo un cliente real puede recibir un PDF

`settings.json` trae `"confirmed": false`. Mientras sea `false`, **ningún documento de un cliente real se envía por WhatsApp**
(el envío responde `legal_unconfirmed`). Los de prueba sí. Se cambia a `true` solo cuando los textos legales estén aprobados.

## Otras cosas que se cambian en `settings.json`

| Clave | Para qué |
|---|---|
| `template_version` | Un número de versión que queda anotado en cada archivo guardado. Conviene subirlo al cambiar un diseño |
| `captions` | La frase que acompaña al PDF en WhatsApp, una por tipo. `{{number}}` se reemplaza por el número del documento |

## Lo que todavía no hay

- **Plantillas en inglés:** hoy son solo en español. Para tener las dos, se duplica cada archivo y se elige por idioma del cliente (hay que pedirlo).
- **Volver a generar un PDF ya emitido:** el documento emitido conserva el archivo con el que salió. Un rediseño solo aplica a los documentos nuevos.
- **Enlace público `GET /d/{token}`:** depende de Access (CRM-T3). Hoy el PDF se baja desde el panel y se envía por WhatsApp.
- **Quién emite solo:** el bot emite y envía la cotización (al cotizar) y la orden de compra (al confirmar); la orden de trabajo solo se emite. A un cliente real, nada de eso ocurre mientras `confirmed` sea `false`. Desde el panel (ficha de la oportunidad, sección Documentos) se puede generar, descargar y enviar a mano.
