# Bitácora: demo visual (3 de noviembre de 2026)

Registro de lo que se hizo, lo que se encontró y lo que sigue abierto. Sin horas: las horas van solo en el chat.
Rama de trabajo: `wip/demo-visual` (sobre `wip/crm-t9b`). Nada se publicó.

## 1. Demo local de un clic

Archivos nuevos: `INICIAR-DEMO.cmd`, `DETENER-DEMO.cmd`, `scripts/demo-start.ps1`, `scripts/demo-stop.ps1`; `.demo/` quedó en `.gitignore` (registros y números de proceso).

- **Iniciar:** busca Node 24 (`.tools` de la copia de trabajo, luego `.tools` junto al `.git` compartido, luego el PATH); enciende Docker Desktop si hace falta; claves locales; base y PostgREST; roles; migraciones; datos base y de demostración; `core-api` (`start:demo`) y el panel con `VITE_DATA_PROVIDER=core-api`; espera a que respondan y abre el navegador.
- **`INICIAR-DEMO.cmd limpio`:** borra el volumen local antes de empezar.
- **Detener:** apaga el panel y `core-api` (por número de proceso guardado y, si quedó uno suelto, por el puerto, solo si es `node`) y baja los contenedores. Conserva los datos y deja Docker Desktop abierto.
- Todo escucha solo en `127.0.0.1`. Imágenes de Docker las mismas que ya estaban fijadas.

### Pruebas de punta a punta

| Prueba | Resultado |
|---|---|
| Arranque con datos previos | 25 s, todo listo |
| Detener, luego arranque `limpio` | 23 s. Puertos 3000, 5173, 55432 y 55300 libres tras detener y ocupados tras iniciar |
| `npm run demo` sobre la base limpia | 42 de 42, exit 0 (tres corridas en total) |
| Panel tras la demo | 10 contactos (4 de ejemplo y 6 de la demo; *Prueba Sebas* oculto), tablero con 8 columnas, conversación de Carlos Pérez completa, calendario con las citas |
| Interruptor "Mostrar clientes de prueba" | Aparece *Prueba Sebas* (dos) y el menú cambia a "Ocultar…" |
| Agenda por `core-api` (pasos 9 a 11 de la guía) | Reserva OK; mismo horario con otro cliente → `slot_taken`; confirmar sin cotización → `quote_required`; confirmar "Ana Gómez" con dirección OK y reemplaza su reserva; reprogramar a horario ocupado → `slot_taken` y la cita se queda; reprogramar a uno libre OK; cancelar OK; reservar dentro de una ausencia → `outside_availability`; borrar la ausencia OK |

### Hallazgos al probar

1. **Mi guía estaba mal en dos cosas** y se corrigió: la barra del calendario tiene **Hoy** arriba (no abajo a la derecha), y las dos oportunidades de ejemplo (*Casa con garaje*, *Servicio hogar 3 dormitorios*) **no pueden confirmarse** porque no tienen cotización enviada. Para confirmar hay que usar la de *Ana Gómez*.
2. **Las reservas ámbar vencen a los 15 minutos**, también las hechas desde el panel. Quien siga la guía despacio verá desaparecer su reserva. Quedó escrito.
3. **Reprogramar una reserva deja otra reserva** (con 15 minutos nuevos), no una cita confirmada.
4. **Varias oportunidades se llaman igual** ("Nueva consulta"): el diálogo de nueva cita las distingue con cliente y etapa. La guía lo explica.
5. **Corridas acumuladas:** cada `npm run demo` deja otro Carlos Pérez, Ana Gómez…; tras unas cuantas la lista confunde. Por eso existe `limpio`.
6. En la corrida con datos previos, el contacto de nombre tapado (*Probador ••1234*) es el de las pruebas de mensaje duplicado y firma falsa: no es un error.
7. Docker tiene además contenedores `supabase_*_atomic-crm-demo` de otro proyecto en marcha. No los toqué: el detener solo baja `salvionix-local`.

### Abierto o no verificado

- **El cuelgue de `INICIAR-DEMO.cmd limpio` + `npm run demo` ya está explicado y corregido:** ver la incidencia 1 más abajo.
- Las **capturas de pantalla fallaron** (la ventana del navegador estaba oculta). Verifiqué leyendo el texto de las páginas y con llamadas a la API; el aspecto visual (colores ámbar y verde, borde punteado, franjas de horario) viene del código, no lo vi.
- Los pasos de la guía que dependen de hacer clic (arrastrar tarjetas, abrir el bloque de una cita, los diálogos de mover y cancelar, añadir una tarea) vienen de las pruebas automáticas y de la sesión anterior, no los repetí con clics hoy.
- La limpieza `limpio` también borra la base de pruebas del mismo volumen; se recrea sola al correr las pruebas.

## 2. Pendiente

1. Recorrer la guía con clics (pasos 5, 6, 7, 10, 11) y avisar qué no coincide.
2. CRM-T7a sigue esperando la llave de Anthropic.

## 3. Incidencias

Cada fallo del CRM y de su arranque local: qué pasó, la causa, la solución y cómo se verificó. Sin horas.

### Incidencia 1. `INICIAR-DEMO.cmd` + `npm run demo` encadenados se quedan colgados

- **Qué pasó:** al encadenar las dos órdenes con la salida del `.cmd` en una tubería, la orden no terminaba. Se reprodujo: tardó 428 s, hasta que se apagaron los servicios a mano. La demo, que corrió recién entonces, salió con código 2 ("core-api does not answer") porque ya estaba apagado.
- **Causa:** `core-api` y el panel se lanzaban con `Start-Process`, que les hace heredar la tubería de salida y la consola de quien los lanzó. Cualquiera que lea esa salida espera a que los servidores terminen. Es la misma herencia de consola que explicaría que cerrar la ventana del `.cmd` apague los servidores (ver incidencia 2).
- **Solución:** `scripts/demo-start.ps1` crea los procesos por WMI, separados de la consola y sin handles heredados. Como no heredan el entorno, `PATH` y `VITE_DATA_PROVIDER` van en la línea de comandos. Los registros siguen en `.demo/`.
- **Verificación:** la misma orden encadenada terminó en 23 s y la demo dio 42 de 42, exit 0. Los procesos quedan con `WmiPrvSE` como padre y sin ventana. `DETENER-DEMO.cmd` los apaga: 0 puertos ocupados y 0 procesos tras detener.

### Incidencia 2. Empresas dice "Failed to fetch" y las imágenes salen rotas (captura del usuario)

- **Qué pasó:** en Empresas aparece "Failed to fetch", y el logo y la imagen de "No se encontraron empresas" no cargan.
- **Lo que se comprobó:** con los servicios arriba **no se reproduce**. `GET /admin/rest/companies_summary` da 200, el recurso está permitido en `ADMIN_RESOURCES`, la página muestra "No se encontraron empresas" (la lista está vacía a propósito) y las tres imágenes (`salvionix-mark.png`, `empty.svg` y el favicon) cargan, tanto en `127.0.0.1:5173` como en `localhost:5173` (ambos orígenes están permitidos por CORS). Las rutas de `public/` y de `root/logos/` existen después del subtree.
- **Causa probable (no se pudo reproducir):** el síntoma completo (un mensaje de red fallida y también imágenes rotas) es el de **Vite y `core-api` caídos con la pestaña abierta**: las imágenes las sirve Vite y los datos `core-api`. Hay dos formas de que pasara: (a) la demo se apagó al terminar la sesión anterior, con la pestaña todavía abierta; (b) con el lanzador anterior, cerrar la ventana del `.cmd` podía apagar los servidores (incidencia 1). La (b) es una hipótesis: no la probé con una ventana real.
- **Solución:** la de la incidencia 1 cubre la (b). Además se corrigió un defecto real de rutas: las tres pantallas vacías (`CompanyEmpty`, `ContactEmpty`, `DealEmpty`) pedían la imagen con `./img/empty.svg`, una ruta relativa a la página que se rompe si el panel se sirve bajo otra ruta. Ahora usan `import.meta.env.BASE_URL`.
- **Verificación:** recorrido de 16 rutas con un interceptor de `fetch`: 0 respuestas de error y 0 fallos de red. Ninguna imagen rota en Panel principal, Contactos, Empresas y Oportunidades.
- **Límite:** si vuelve a pasar con los servicios arriba, hace falta la captura con la pestaña Red del navegador abierta.

### Incidencia 3. La búsqueda global (Ctrl K) mostraba clientes de prueba

- **Qué pasó:** buscar "Prueba" devolvía a *Prueba Sebas* y su oportunidad aunque las listas los ocultan.
- **Causa:** la función `global_search` de la base no conoce la marca de prueba, y el panel no la filtraba. Aviso: en mi primera comprobación el interruptor "Mostrar clientes de prueba" estaba encendido en ese navegador (lo había dejado yo), así que esa observación no probaba nada; el defecto se confirmó leyendo el código y con la prueba nueva.
- **Solución:** `globalSearch` del proveedor `core-api` quita contactos, oportunidades y lo que cuelga de ellos (tareas, notas) que pertenezcan a un cliente de prueba, salvo que el usuario haya pedido verlos.
- **Verificación:** con el interruptor apagado, "Prueba" da "No se encontraron resultados" y "Carlos" da los dos Carlos. Dos pruebas nuevas (las oculta; las muestra si se pidió, sin hacer consultas de más).
- **Sobre el ADR-001:** la búsqueda global **sí funciona** con `core-api` (`POST /admin/rest/rpc/global_search` da 200 y el diálogo de Ctrl K muestra resultados de contactos, oportunidades y tareas). No dependía de Supabase.

### Incidencia 4. Panel principal solo mostraba la tarjeta "¿Qué sigue?"

- **Qué pasó:** con la demo cargada, el Panel principal enseñaba solo una lista de arranque (instalar, añadir contacto, añadir primera nota) y ninguno de sus bloques.
- **Causa:** Atomic CRM muestra esa lista hasta que existe al menos una nota de contacto. Con `core-api` la conversación reemplaza a las notas, así que nunca había notas.
- **Solución:** con el proveedor `core-api` no se exige la primera nota.
- **Verificación:** el Panel principal muestra contactos prioritarios, importes de oportunidades, actividad reciente (sin clientes de prueba con el interruptor apagado) y próximas tareas.

### Incidencia 5. La ficha de una oportunidad se rompe ("Algo salió mal")

- **Qué pasó:** abrir una oportunidad creada por el bot mostraba la pantalla de error, por ejemplo `#/deals/6/show` ("Invalid date format. Expected YYYY-MM-DD") y `#/deals/4/show` ("Cannot read properties of null").
- **Causa:** `DealShow` da por hecho que toda oportunidad trae fecha de cierre esperada y monto. Las del bot no tienen fecha de cierre, y las que aún no se cotizaron no tienen monto.
- **Solución:** sin fecha se muestra "—" y no se marca "vencida"; sin monto se muestra $0.00, como ya hace la columna del tablero.
- **Verificación:** 12 oportunidades y 12 contactos se abren sin error, y las pantallas de edición también; sin respuestas de error. Dos pruebas nuevas (`DealShow.test.tsx`); quitando cada arreglo, su prueba falla. Panel completo: 375 pruebas pasan, tipos sin errores.

### Incidencia 6. `ROUTES.md` no listaba los recursos del proxy

- **Qué pasó:** `ROUTES.md` documentaba `/admin/rest/*` como una sola ruta y solo nombraba dos recursos de solo lectura; `technicians_summary` y `rpc/global_search` no aparecían.
- **Solución:** la fila lista ahora todos los recursos de `ADMIN_RESOURCES`, cuáles son de solo lectura y que solo pasa `rpc/global_search`.
- **Verificación:** la prueba que compara `ROUTES.md` con las rutas registradas sigue pasando.

### Sin explicar

- Al primer recorrido salieron en la consola del navegador unos pocos errores 404, 409 y 400 que no identifiqué. Pudieron venir de mis llamadas de prueba a la agenda (409 y 400 son rechazos esperados de esas reglas). El recorrido posterior con interceptor no vio ninguno.
