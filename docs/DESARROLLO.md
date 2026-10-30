# Desarrollo

## Entorno

Usar Node 24 LTS (`.nvmrc`). WSL2 con Ubuntu 24.04 y Make se recomienda para el
modo completo; la demo puede ejecutarse directamente en Windows. Docker solo
es necesario para el Supabase local opcional del proyecto original.

En esta máquina se prepara una copia portátil de Node dentro de `.tools/`,
excluida de Git. En PowerShell, desde la raíz:

```powershell
$nodeDir = (Get-ChildItem .tools -Directory -Filter 'node-v24*-win-x64' | Select-Object -First 1).FullName
$env:PATH = "$nodeDir;$env:PATH"
cd backoffice
npm.cmd ci --ignore-scripts
npm.cmd run dev:demo -- --host 127.0.0.1
```

No ejecutar instalación normal que active automáticamente scripts de paquetes.
Si esbuild necesita su postinstall, revisar y ejecutar solo `npm rebuild esbuild`.

## Secretos

Instalar gitleaks >= 8.19 desde sus releases oficiales, verificar su checksum y
añadirlo al PATH. En esta máquina se usa la copia local verificada v8.30.1 en
`.tools/gitleaks/gitleaks.exe`. Activar el hook después de cada clon:

```sh
git config core.hooksPath .githooks
```

El hook falla si falta gitleaks. No omitirlo con `--no-verify`. El CI vuelve a
escanear el historial completo. No se usa la acción comercial de gitleaks.
Nunca commitear secretos, dumps, datos reales ni exportaciones con credenciales.

## Validación

Desde backoffice, con Node 24:

```sh
npm run lint
npm exec playwright install chromium chromium-headless-shell
npm run test:unit:app -- --run --project app --maxWorkers=2
NODE_ENV=CI npm run build:demo
```

En PowerShell establecer `$env:NODE_ENV = 'CI'` antes del build. Esto evita que
el analizador de bundles abra una ventana. El CI instala Chromium en Linux.
Si Node rechaza el certificado de descarga en Windows, usar
`$env:NODE_USE_SYSTEM_CA = '1'` para emplear los certificados de confianza del
sistema; no desactivar TLS. La copia local de navegadores está en
`.tools/playwright`; establecer PLAYWRIGHT_BROWSERS_PATH a su ruta absoluta.

## Flujo y alojamiento

Repositorio privado `salvionix-platform` en la cuenta personal del responsable,
con GitHub Project `Salvionix Platform`. Transferir después a la organización
de Bytogam, mantenerlo privado y actualizar remotos, enlaces e integraciones.

Una rama por bloque, por ejemplo `codex/f1-b3-core-api-webhooks`. Incluir F1-Bx en
commits y PR. Main queda reservado para versiones revisadas. Solicitar revisión
de Joel antes del merge; registrar cualquier limitación del plan de GitHub.
Actualizar Excel y evidencia en Discord solo después de completar cada bloque.

## Configuración externa pendiente

En GitHub: crear repo privado, activar Dependabot alerts, dar acceso a Joel y
crear/vincular el Project. La futura organización requerirá 2FA y dos owners.
No cambiar miembros o seguridad de cuentas sin identificar sus usuarios.

En Discord: crear webhook en #github y guardar su URL en Bitwarden. En GitHub,
usar esa URL con `/github`, content type application/json y eventos Push y Pull
request. Verificar una entrega real. Tratar la URL como secreto y no guardarla
en este repo. Actualizar el Excel con enlace al repo cuando F1-B0 esté completo.
