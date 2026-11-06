<#
.SYNOPSIS
  Live flow of the presentation, step by step, pausing for Enter before each one. Run it with the presentation up
  (INICIAR-PRESENTACION.cmd). It talks only to core-api and the bot's tools; no n8n, no Anthropic, no VPS.
  Each step prints what happened and what to look at in the panel.
.PARAMETER Detalle
  Detailed mode: shows each call of the bot (method, path, body sent and answer), with secrets hidden as ***.
.PARAMETER Desde
  Start at this step (1 to 4). The steps after the first need the client that step 1 creates.
#>
param([ValidateRange(1, 4)][int]$Desde = 1, [switch]$Detalle)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Find-Node {
  $common = (git -C $root rev-parse --git-common-dir).Trim()
  $sharedRoot = Split-Path ([IO.Path]::GetFullPath([IO.Path]::Combine($root, $common))) -Parent
  foreach ($base in @((Join-Path $root '.tools'), (Join-Path $sharedRoot '.tools'))) {
    $found = Get-ChildItem $base -Directory -Filter 'node-v24*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath -and (& $onPath.Source --version) -like 'v24*') { return Split-Path $onPath.Source -Parent }
  throw 'No encuentro Node 24. Debe estar en .tools\node-v24* (ver docs/DESARROLLO.md).'
}

$nodeDir = Find-Node
$env:PATH = "$nodeDir;$env:PATH"
$npm = Join-Path $nodeDir 'npm.cmd'
Set-Location (Join-Path $root 'core-api')

$steps = @(
  @{ n = 1; title = 'Llega un cliente nuevo por WhatsApp'; next = 'Se simula el mensaje de un cliente nuevo. Mira la lista de Contactos y el tablero de Negocios.' },
  @{ n = 2; title = 'Javier guarda la ficha'; next = 'El cliente dice quien es y donde esta. Abre el negocio y mira la ficha.' },
  @{ n = 3; title = 'Javier cotiza'; next = 'El cliente pregunta el precio. Mira el tablero: el negocio pasa a Cotizado, con monto y una nota.' },
  @{ n = 4; title = 'El cliente pide una persona'; next = 'El cliente pide hablar con alguien. Mira Tareas (o el panel de inicio).' }
)

Write-Host ''
Write-Host '  FLUJO EN VIVO - Salvionix CRM' -ForegroundColor Cyan
Write-Host '  Panel: http://127.0.0.1:5173/   (la conversacion no se muestra en la ficha: es una vista previa)'
Write-Host ''

foreach ($step in $steps) {
  if ($step.n -lt $Desde) { continue }
  Write-Host "  Paso $($step.n) de 4 - $($step.title)" -ForegroundColor Yellow
  Write-Host "  $($step.next)"
  [void](Read-Host '  Presiona Enter para ejecutarlo')
  if ($Detalle) { & $npm run --silent flujo -- $step.n --detalle } else { & $npm run --silent flujo -- $step.n }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "  El paso $($step.n) fallo. Lee los mensajes de arriba." -ForegroundColor Red
    exit 1
  }
  Write-Host ''
}
Write-Host '  Listo. Para repetir con datos limpios: INICIAR-PRESENTACION.cmd limpio' -ForegroundColor Green
