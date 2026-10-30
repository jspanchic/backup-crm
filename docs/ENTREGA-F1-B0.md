# Entrega F1-B0

Fecha: 30 de octubre de 2026. Estado: en proceso; no cerrar aún en el Excel.

## Alcance acordado

Por indicación del responsable, el repo privado y el GitHub Project se crearán
en su cuenta personal. La organización de Bytogam se creará posteriormente y
recibirá el repositorio por transferencia. No se ha creado ningún recurso remoto.

## Preparado localmente

- [x] Rama `codex/f1-b0-repo-base`.
- [x] Atomic CRM v1.6.0 importado con git subtree y hash registrado.
- [x] Licencia MIT intacta, LICENSE propio y NOTICE.
- [x] Estructura core-api, db, infra, n8n, docs y .github.
- [x] .gitignore y hook versionado de gitleaks v8.30.1 activado localmente.
- [x] Commit con token ficticio aleatorio rechazado en repo temporal aislado.
- [x] Historial escaneado sin hallazgos nuevos; seis fixtures públicas revisadas.
- [x] Plantilla de PR y workflow de CI preparados.
- [x] Node 24.22.2 portátil y dependencias instaladas con --ignore-scripts.
- [x] Lint correcto.
- [x] Build de demo correcto (TypeScript + Vite).
- [x] Pruebas de navegador: 26 archivos, 199 pruebas correctas y una omitida.
- [x] Demo abierta en Chromium sin errores JavaScript.

La suite se ejecuta con `--maxWorkers=2` para limitar consumo de recursos. Se
corrigió una prueba de avatares del upstream sin modificar lógica de producción.
El build conserva avisos de upstream por dependencias circulares y tamaño del
bundle; no impidieron la compilación. ESLint avisa de `.eslintignore` obsoleto.

## Pendiente externo

- [ ] Conectar GitHub e identificar la cuenta personal de destino.
- [ ] Crear `salvionix-platform` privado y publicar el código.
- [ ] Crear GitHub Project `Salvionix Platform` y vincular el repo.
- [ ] Activar Dependabot alerts.
- [ ] Configurar acceso de Joel y flujo de revisión.
- [ ] Ejecutar el CI remoto y verificar resultado.
- [ ] Configurar webhook de Discord, guardar URL en Bitwarden y probar entrega.
- [ ] Recibir el Excel de seguimiento; registrar enlace y completar solo al cerrar.
- [ ] Posteriormente: transferir a Bytogam, exigir 2FA y establecer dos owners.

## Observación de la copia local

Después de la importación apareció eliminado
`backoffice/.devcontainer/claude-code/install.sh`, sin una eliminación ejecutada
como parte de esta tarea. La eliminación se deja sin incluir en los commits;
el archivo sigue en el historial de upstream. No afecta al modo demo.

## GitHub Project previsto

Título: Salvionix Platform. Visibilidad: privada. Estados: Pendiente, En proceso,
En revisión, Completada. Primera tarea: F1-B0 · Repo y CRM base, En proceso,
con este checklist. No inventar códigos ni filas del Excel aún no recibido.
