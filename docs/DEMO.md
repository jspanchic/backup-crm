# Guion de la demo

Todo corre **en local**, sin VPS, sin WAHA real y sin Claude. Los clientes y sus mensajes son ficticios, con
teléfonos nuevos en cada corrida. Lo que entra a `core-api` es un webhook **firmado** con el formato que usa
WAHA; lo que sale es lo que WAHA enviaría. Lo guardado se comprueba en la base.

## Qué es real y qué está simulado

| Pieza | En la demo |
|---|---|
| `core-api`, la base, las reglas de la agenda, los precios, el titular, "Prueba X" | **Reales** |
| Firma, duplicados, E.164, tarjetas, token de 15 min, cola de envío | **Reales** |
| WhatsApp (WAHA) | **Simulado** (`core-api/dev/waha-sim.ts`). El formato de `payload.id`, la codificación de la firma y la unidad del timestamp son **SUPUESTOS** hasta tener una captura real |
| El bot | **De guion** (`core-api/dev/mock-bot.ts`): habla con las mismas herramientas y el mismo contrato que usará Javier en n8n, pero sin Claude y con frases fijas. Con `--bot external` el guion corre contra n8n |
| Precios, margen entre servicios, disponibilidad del técnico | **Datos de ejemplo "por confirmar"** |

## Cómo correrla

Desde `core-api/`, con Node 24 y Docker. La primera vez:

```bash
npm run local:init
```

```bash
npm run local:up
```

```bash
npm run db:bootstrap
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run db:seed-demo
```

Luego, en una terminal el servicio (con pausas cortas entre mensajes):

```bash
npm run start:demo
```

y en otra, la demo:

```bash
npm run demo
```

La demo narra cada paso, marca con ✅ o ❌ cada comprobación y termina con un código de salida distinto de cero si algo falla.
Se puede repetir las veces que se quiera: usa teléfonos nuevos y toma el siguiente horario libre.

Para ver las citas, los contactos y las oportunidades en el panel, desde `backoffice/`:

```bash
VITE_DATA_PROVIDER=core-api npm run dev
```

**Con n8n** (cuando el flujo de Javier esté listo): `npm run demo -- --bot external`. La demo no cambia; solo deja de arrancar el bot de guion.

**Un mensaje suelto**, como lo mandaría WAHA: `npm run sim -- --phone 12025550123 --text "Hola" --name Carlos`, y con `--twice` el mismo mensaje se entrega dos veces.

## Los pasos

| # | Qué se ve | Qué se comprueba |
|---|---|---|
| 1 | **Cliente nuevo.** Carlos escribe por primera vez. Javier saluda, pide el nombre y si es hogar o empresa | Contacto creado con su nombre, cliente real, con responsable, oportunidad en "Contactado", conversación guardada |
| 2 | **Vuelve y es reconocido.** Carlos escribe otra vez | Lo llama por su nombre; mismo contacto, misma conversación, el teléfono guardado una sola vez en formato internacional |
| 3 | **Cotización.** "3 dormitorios y garage para 2 autos" | El monto que dice Javier es el que calculó la base; la superficie es la que da la tabla; los precios quedan marcados "por confirmar"; la oportunidad pasa a "Propuesta enviada" |
| 4 | **Horarios, reserva y confirmación.** Ana ve los mismos horarios; Carlos reserva el primero, da la dirección y confirma | Reserva provisional de 15 min ligada a la oportunidad; el mensaje de confirmación lo escribe `core-api` con el día y la hora de la cita; cita confirmada, oportunidad "Servicio contratado", tarea de seguimiento |
| 5 | **Cruce rechazado.** Ana elige el horario que Carlos ya tomó | Javier dice que ya no está libre; en la agenda sigue una sola cita; **un insert directo en la base también se rechaza** (restricción de exclusión) |
| 6 | **Escalar.** Rosa pide hablar con una persona | El bot avisa y se pausa; se crea una tarea asignada al responsable de la marca; no contesta más, pero los mensajes se siguen guardando |
| 7 | **"Prueba X".** Un cliente dice llamarse "Prueba Sebas" | Contacto y oportunidad marcados como prueba; su cita no bloquea la agenda: Ana reserva el mismo horario |
| 8 | **Número reasignado.** Marta escribió hace 100 días; ahora alguien escribe desde su número | Javier confirma el nombre; al decir "soy Pedro" se cierra el titular anterior y se abre un contacto nuevo; Marta conserva su historial |
| Extra | Un mensaje entregado dos veces y uno con firma falsa | El duplicado se descarta y Javier contesta una vez; la firma falsa da 401 y no cambia nada |

## Si algo sale mal

| Síntoma | Causa probable |
|---|---|
| "core-api does not answer" | Falta `npm run start:demo` |
| "No hay un canal demo" | Falta `npm run db:seed-demo` |
| La demo espera y falla por tiempo | El bot no contesta: `BOT_URL_JAVIER` no apunta al bot, o `BOT_HMAC_SECRET` no coincide |
| ❌ en "monto" o "horarios" con `--bot external` | Javier dijo algo distinto de lo que dice la base: la revisión de `responder` lo habría frenado; mira `core.reply_reviews` |
| Sin horarios libres | El técnico de ejemplo trabaja de lunes a viernes de 09:00 a 17:00 y el horizonte es de 14 días: revisa `core.technician_availability` |

## Calendario, conversación y documentos de la presentación (datos de prueba)

Con `INICIAR-PRESENTACION.cmd limpio` la agenda, la conversación de la ficha y los documentos funcionan con datos ficticios (todo `is_test`; nada sale a WhatsApp):

- **Agenda:** un aplicador de ejemplo, «Aplicador de ejemplo (Orlando)», con 60 minutos de servicio más 30 de traslado. Sus días y franjas salen de **un solo archivo comentado**, `db/seeds/aplicadores.jsonc`, y se cambian por los reales como explica `docs/DATOS_REALES.md` (también desde Agenda → Disponibilidad). Las citas de ejemplo se calculan desde el día en que se carga la semilla, así que conviene encender con `limpio` el mismo día de la presentación.
- **Conversación:** dos fichas (María Fernández y Patricia Nguyen) traen su conversación de WhatsApp con Javier.
- **Documentos:** esos dos negocios traen cotización, orden de compra y orden de trabajo en PDF (las genera el mismo código del panel; hace falta el motor de PDF, que ahora se enciende junto con la base). Si no estaba encendido al cargar los datos, se generan con los botones del negocio.
- **Cotización en PDF:** menos texto, metraje destacado, descuento solo si la marca lo tiene activo y una línea de impuesto con la tasa de la marca (6,5 % de ejemplo). Ver `docs/PLANTILLAS_PDF.md`.
- **Sigue como «Próximamente · 20/11»:** la agrupación de citas por zona con descuento.