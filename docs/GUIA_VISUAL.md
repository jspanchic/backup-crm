# Guía visual: recorrer el CRM en el navegador

Esta guía es para **ver** el CRM funcionando, sin tocar código. Todo corre en tu computadora: no se publica nada, no hay
WhatsApp real y el bot Javier es de guion (sin Claude). Los clientes y sus mensajes son ficticios.

## Antes de empezar

| Qué | Cómo |
|---|---|
| Encender todo | Doble clic en **`INICIAR-DEMO.cmd`** (carpeta raíz del proyecto). Tarda unos 25 segundos si Docker ya está abierto, y hasta un par de minutos si tiene que encenderlo. Al terminar abre el navegador en el panel: `http://127.0.0.1:5173/` |
| Empezar de cero | Desde una terminal en la raíz: `INICIAR-DEMO.cmd limpio`. Borra los datos locales y vuelve a cargar solo los de ejemplo. Úsalo la primera vez, o cuando la lista esté llena de corridas anteriores |
| Apagar todo | Doble clic en **`DETENER-DEMO.cmd`**. Apaga el panel, `core-api` y la base. Los datos quedan guardados para la próxima. Docker Desktop sigue abierto: ciérralo desde su icono si quieres liberar memoria |
| Si algo falla | Los registros están en la carpeta `.demo` (`core-api.log`, `panel.log` y sus `.err.log`) |

Lo que se enciende: la base de datos y PostgREST (Docker), `core-api` en el puerto 3000 y el panel en el 5173. Todo en `127.0.0.1`:
nadie más en tu red puede entrar.

**No hay pantalla de usuario y contraseña.** El panel entra como el responsable de ejemplo (Sebastián). El acceso real con
Cloudflare Access es otra tarea.

## Los 12 pasos

Los pasos van en orden: el 2 llena el CRM con clientes y conversaciones, y los demás los recorren. Las horas de las citas
cambian según el día y la hora en que lo corras: siempre cuenta con "el primer horario libre", no con una hora fija.

### 1. Abrir el panel

- **Qué hacer:** `INICIAR-DEMO.cmd limpio` y espera a que se abra el navegador.
- **Qué debes ver:** una barra superior con **Panel principal, Contactos, Empresas, Oportunidades, Citas**, un buscador
  (`Ctrl K`) y tu avatar. El Panel principal muestra la tarjeta "¿Qué sigue?" de arranque: no hace falta seguirla.
- **Si ves una pantalla en blanco:** espera 5 segundos y recarga con `F5`. Si sigue, mira `.demo\panel.err.log`.

### 2. Llenar el CRM con la demo

- **Qué hacer:** abre una terminal (PowerShell) y corre `npm run demo`. Los comandos exactos están en la sección
  [Cómo correr `npm run demo`](#cómo-correr-npm-run-demo-y-cómo-leer-su-resultado). Cuando termine, vuelve al navegador y
  recarga con `F5`.
- **Qué debes ver en la terminal:** ocho escenas narradas y, al final, `✅ 42 de 42 comprobaciones correctas`.

### 3. La lista de contactos

- **Qué hacer:** clic en **Contactos**.
- **Qué debes ver:** unos diez contactos. Los de ejemplo se llaman *Carlos (demo)*, *Ana (demo)*, *Luis (demo)* y *Rosa (demo)*.
  Los que creó la demo son *Carlos Pérez*, *Ana Gómez*, *Rosa Salazar*, *Marta*, *Pedro* y otro con nombre tapado
  (*Probador ••1234*, el de las pruebas de mensaje duplicado). *Carlos Pérez* y *Rosa Salazar* dicen "1 tarea".
- **Lo que NO debes ver:** *Prueba Sebas*. Es un cliente de prueba y está oculto a propósito (paso 12).
- A la izquierda hay filtros: última actividad, estado, etiquetas, tareas y responsable.

### 4. La conversación en la ficha

- **Qué hacer:** clic en **Carlos Pérez**. Queda abierta la pestaña **Conversación**.
- **Qué debes ver:** toda la charla, en orden, con quién habla (**Cliente** o **Javier**) y la hora: el saludo, el nombre, "para mi
  casa", la **cotización** (área cubierta, subtotal, descuento, *VALOR ESTIMADO*), los horarios ofrecidos, la reserva, la dirección
  y el mensaje de confirmación. A un lado: teléfono en formato internacional (+1…), "A tu cargo" y etiquetas.
- La pestaña **Notas** es para lo que escriba una persona; la conversación no se edita.
- **Prueba también** la ficha de *Rosa Salazar*: termina cuando ella pidió hablar con una persona, y al final hay un mensaje suyo
  ("¿Hay alguien ahí?") sin respuesta de Javier, porque el bot quedó pausado.

### 5. Cambiar la etapa de una oportunidad

- **Qué hacer:** en la ficha de Carlos, sección **Oportunidades**, abre el selector de etapa de "Nueva consulta" y elige otra, por
  ejemplo **Seguimiento de propuesta**.
- **Qué debes ver:** las etapas disponibles son Nueva consulta, Contactado, Evaluación del espacio, Propuesta enviada, Seguimiento
  de propuesta, Servicio contratado, No concretado y Aplazado. Al elegir una, aparece el aviso de guardado. Si recargas la página,
  la etapa sigue ahí.
- **Después:** devuélvela a **Servicio contratado** para que el resto de la guía cuadre.

### 6. El tablero de oportunidades

- **Qué hacer:** clic en **Oportunidades**.
- **Qué debes ver:** ocho columnas, una por etapa, con el total en dinero de cada una. La tarjeta de Carlos está en **Servicio
  contratado** con **$208**; la de Ana, en **Propuesta enviada** con **$150**. Los montos son los que calculó la base, no los que
  "dijo" el bot.
- **Prueba:** arrastra una tarjeta a otra columna y suéltala. Se guarda al soltar; recarga para comprobarlo.
- Las oportunidades de *Prueba Sebas* no aparecen aquí (paso 12).

### 7. Tareas

- **Qué hacer:** en la ficha de *Carlos Pérez* mira la sección **Tareas**; luego abre la de *Rosa Salazar*.
- **Qué debes ver:** a Carlos le creó una tarea de **Seguimiento** ("Dar seguimiento al servicio contratado…") al confirmar la
  cita. A Rosa le creó otra para atenderla a mano, asignada a Sebastián. Con **Añadir tarea** puedes crear una; márcala como hecha
  y vuelve a la lista de Contactos: el "1 tarea" cambia.

### 8. El calendario de citas

- **Qué hacer:** clic en **Citas**.
- **Qué debes ver:** una semana de **lunes a domingo** de un técnico (*Sample Technician*), con la zona horaria de la marca
  (`America/New_York`) en la barra. Franja verde clara = horario de atención (lunes a viernes, 09:00 a 17:00); gris = ausencia.
  Los bloques traen la hora y el cliente. **Verde = confirmada, ámbar = reservada por 15 minutos**, gris = realizada, rojo = no se
  presentó, y con **borde punteado** las de un cliente de prueba.
- Arriba, junto al nombre del técnico, están **Hoy** y las flechas de semana anterior y siguiente. **Calendario** y **Lista** (a la
  izquierda) cambian entre la cuadrícula y las mismas citas como tabla. A la derecha, **Disponibilidad** y **Nueva cita**.
- Una reserva ámbar **vence a los 15 minutos** si nadie la confirma, igual que cuando la hace el bot. Si pasa ese rato y no la ves,
  es por eso.

### 9. Crear una cita y ver que no se cruzan

- **Qué hacer:** **Nueva cita**.
  1. Escribe "Casa" y elige **Casa con garaje**. Elige un día hábil futuro (que no sea hoy si ya pasó la hora), a las **11:00**, y
     pulsa **Reservar**.
  2. Aparece "Horario reservado" y el bloque ámbar en el calendario.
  3. Repite con **Servicio hogar 3 dormitorios** en **el mismo día y hora**.
- **Qué debes ver en el 3:** el rechazo *"Ese horario ya está ocupado por otra cita (con su margen)."* La regla no la pone la
  pantalla: la aplica la base de datos, igual que con el bot.
- **Para confirmar:** **Nueva cita**, escribe "Nueva", elige **Nueva consulta · Ana Gómez · Propuesta enviada** (varias
  oportunidades se llaman igual: el cliente y la etapa las distinguen), otro horario libre, una dirección, marca **Confirmar ahora**
  y **Reservar**. Queda en verde y su reserva anterior desaparece.
- **Para ver la regla de la cotización:** con *Casa con garaje* o con *Servicio hogar 3 dormitorios* (oportunidades de ejemplo que
  nunca recibieron una cotización del bot), **Confirmar ahora** da *"Falta una cotización enviada."*

### 10. Reprogramar y cancelar

- **Qué hacer:** clic en un bloque del calendario. Se abre su ficha con **Confirmar** (si es una reserva), **Reprogramar** y
  **Cancelar cita**.
- **Qué debes ver:** al **Mover** a otro día u hora, la cita pasa al nuevo horario ("Cita reprogramada"). Si era una reserva ámbar, sigue
  siendo una reserva, con 15 minutos nuevos. Si el horario nuevo está
  ocupado, da el mismo rechazo y **la cita se queda donde estaba**. **Cancelar cita** pide confirmación ("El horario queda libre")
  y el bloque desaparece.

### 11. La disponibilidad del técnico

- **Qué hacer:** botón **Disponibilidad**.
- **Qué debes ver:** el **Horario semanal** (lunes a domingo, con "No atiende" en los días vacíos) y la lista de **Ausencias**.
  Agrega una ausencia de un día entero y guarda: sale "Ausencia agregada" y, si cubría alguna cita, el aviso de cuántas hay que
  reprogramar (las citas **no** se tocan solas).
- **Prueba:** intenta reservar dentro de la ausencia: *"Ese horario está fuera de la disponibilidad del técnico o en una ausencia."*
  Luego borra la ausencia con el icono de papelera.

### 12. Clientes de prueba

- **Qué hacer:** menú de tu avatar → **Mostrar clientes de prueba**. Vuelve a **Contactos**.
- **Qué debes ver:** aparece *Prueba Sebas* (dos, uno de ejemplo y uno de la demo) y, en **Citas**, sus bloques con borde punteado. El
  menú ahora dice **Ocultar clientes de prueba**; púlsalo para esconderlos otra vez.
- **Por qué importa:** cualquiera que se llame "Prueba …" queda marcado como prueba y **no cuenta** en reportes, tablero ni
  disponibilidad. La cita de un cliente de prueba no bloquea el horario de uno real.

## Cómo correr `npm run demo` y cómo leer su resultado

`npm run demo` es el guion automático: simula a los clientes escribiendo por WhatsApp, deja que el bot de guion conteste y
**comprueba en la base** que todo quedó bien. Necesita que `core-api` ya esté encendido, o sea, que hayas corrido
`INICIAR-DEMO.cmd` antes.

En PowerShell, desde la raíz del proyecto (`C:\salvionix-platform`). La primera línea pone Node 24 en el PATH solo para esa
terminal; es la copia que está en `.tools`:

```powershell
cd core-api
$env:PATH = "C:\CRM\.tools\node-v24.22.2-win-x64;$env:PATH"
npm.cmd run demo
```

Se puede repetir las veces que quieras: cada corrida usa teléfonos nuevos y toma el siguiente horario libre. Cada corrida deja
clientes nuevos en el panel (otro *Carlos Pérez*…): para volver a una lista limpia usa `INICIAR-DEMO.cmd limpio`.

### Cómo leerla

| Qué ves | Qué significa |
|---|---|
| `━━ 1 · Cliente nuevo` … `━━ Extra` | Una escena. Son ocho más el "Extra" de mensajes que no deben pasar |
| `👤 Carlos Pérez: …` | Lo que escribe el cliente |
| `🤖 Javier: …` | Lo que contesta el bot (lo que WAHA enviaría por WhatsApp) |
| `✅ …` | Una **comprobación** que pasó: se miró la base y es cierto |
| `❌ …` | Una comprobación que **falló**. Esa línea dice qué se esperaba |
| `✅ 42 de 42 comprobaciones correctas` | Todo bien. Si dice por ejemplo `40 de 42`, hay dos `❌` más arriba |
| Código de salida | `0` si todo pasó, `1` si falló alguna comprobación, `2` si no pudo arrancar (ver abajo). En PowerShell: `$LASTEXITCODE` |

Qué muestra cada escena, para buscarlo luego en el panel:

| Escena | Qué prueba | Dónde verlo en el panel |
|---|---|---|
| 1 · Cliente nuevo | Crea contacto y oportunidad, con responsable | Contactos → Carlos Pérez; ficha → Conversación |
| 2 · Vuelve y es reconocido | Mismo contacto y teléfono guardado una sola vez | La ficha de Carlos tiene una sola conversación |
| 3 · Cotización | El monto del bot es el que calculó la base; oportunidad a "Propuesta enviada" | Mensaje de cotización en la conversación |
| 4 · Horarios, reserva y confirmación | Reserva de 15 minutos, dirección, confirmación escrita por `core-api`, cita confirmada, tarea de seguimiento | Citas (verde) y Tareas de Carlos |
| 5 · Cruce rechazado | Un segundo cliente no puede tomar el mismo horario | Una sola cita en ese horario |
| 6 · Escalar | El bot se pausa y se crea una tarea para una persona | Ficha de Rosa Salazar |
| 7 · "Prueba X" | El cliente de prueba no bloquea la agenda real | Paso 12 de esta guía |
| 8 · Número reasignado | Marta cede el número a Pedro sin perder su historial | Contactos → Marta y Pedro |
| Extra | Un mensaje repetido se descarta; una firma falsa da 401 | Nada nuevo: no cambia el panel |

### Si no corre

| Mensaje | Qué hacer |
|---|---|
| `core-api does not answer at http://127.0.0.1:3000` (código 2) | Falta encender: `INICIAR-DEMO.cmd` |
| `No hay un canal "demo"` (código 2) | Faltan los datos de ejemplo: `INICIAR-DEMO.cmd limpio` |
| `Missing …: run "npm run local:init"` | Faltan las claves locales: `INICIAR-DEMO.cmd` las crea |
| `npm` o `node` "no se reconoce" | Falta la línea del PATH de Node 24 (arriba) |
| La demo espera y falla por tiempo | El bot de guion no contesta: apaga todo con `DETENER-DEMO.cmd` y vuelve a encender |

## Lo que esta demo NO es

- **No es WhatsApp real.** Los mensajes entran firmados como los mandaría WAHA, pero los fabrica un simulador. El formato exacto
  del identificador, la firma y la hora de WAHA son **supuestos** hasta tener una captura real.
- **El bot es de guion, no Claude.** Contesta con frases fijas, con las mismas herramientas y el mismo contrato que usará Javier en
  n8n. La conexión con Claude (CRM-T7a) espera la llave.
- **Precios, márgenes y disponibilidad son de ejemplo**, marcados "por confirmar".
- **Sin acceso real:** no hay inicio de sesión; usuarios, contraseñas, registro, combinar contactos y adjuntos dicen que
  llegan con la Entrega 2.
- Confirmar una cita desde el panel **no le escribe al cliente**; cancelar una cita confirmada **no cambia la etapa** de la
  oportunidad; no queda registro de quién agendó o movió una cita. Está anotado en `docs/plan/ENTREGA_1.md` (secciones 23 y 24).
- El calendario no se probó en teléfono.
