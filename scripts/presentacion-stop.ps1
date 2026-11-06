<#
.SYNOPSIS
  Stops the presentation: the panel, core-api and the Docker project salvionix-presentacion (the data stays in its own
  volume). With -Borrar the volume of the presentation goes too. Never touches the regular demo or its volume.
  Called by DETENER-PRESENTACION.cmd. Docker Desktop itself is left running.
#>
param([switch]$Borrar)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$state = Join-Path $root '.demo'
$project = 'salvionix-presentacion'

function Say([string]$text) { Write-Host "[presentacion] $text" }

function Stop-Tree([int]$processId) { taskkill /PID $processId /T /F *> $null }

foreach ($item in @(@('panel', 5173), @('core-api', 3000))) {
  $name, $port = $item
  $pidFile = Join-Path $state "pres-$name.pid"
  if (Test-Path $pidFile) {
    $saved = [int](Get-Content $pidFile)
    if (Get-Process -Id $saved -ErrorAction SilentlyContinue) { Stop-Tree $saved }
    Remove-Item $pidFile -Force
  }
  # A leftover of the same kind holds the port: only node processes are stopped.
  $left = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($owner in $left) {
    $command = (Get-CimInstance Win32_Process -Filter "ProcessId = $owner").CommandLine
    if ($command -match 'node') { Stop-Tree $owner } else { Say "El puerto $port lo usa otro programa ($owner); no lo toco." }
  }
  Say "$name apagado."
}

docker info *> $null
if ($LASTEXITCODE -eq 0) {
  $compose = @('compose', '-p', $project, '-f', (Join-Path $root 'infra/local/docker-compose.yml'), '--env-file', (Join-Path $root 'infra/local/.env'))
  if ($Borrar) {
    docker @compose down -v *> $null
    Say 'Base de datos y PostgREST apagados, y el volumen de la presentacion borrado.'
  } else {
    docker @compose down *> $null
    Say 'Base de datos y PostgREST apagados. Los datos de la presentacion se conservan.'
  }
} else {
  Say 'Docker no estaba encendido: no hay contenedores que apagar.'
}
Write-Host ''
Write-Host '  Todo apagado. Docker Desktop sigue abierto; cierralo desde su icono si quieres liberar memoria.'
