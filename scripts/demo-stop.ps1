<#
.SYNOPSIS
  Stops what demo-start.ps1 started: the panel, core-api and the Docker containers (the data stays in its volume).
  Called by DETENER-DEMO.cmd. Docker Desktop itself is left running.
#>
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$state = Join-Path $root '.demo'

function Say([string]$text) { Write-Host "[demo] $text" }

# Stops a process and its children. Only the process we started: first by its saved id, then by whoever listens on its port.
function Stop-Tree([int]$processId) {
  taskkill /PID $processId /T /F *> $null
}

foreach ($item in @(@('panel', 5173), @('core-api', 3000))) {
  $name, $port = $item
  $pidFile = Join-Path $state "$name.pid"
  if (Test-Path $pidFile) {
    $saved = [int](Get-Content $pidFile)
    if (Get-Process -Id $saved -ErrorAction SilentlyContinue) { Stop-Tree $saved }
    Remove-Item $pidFile -Force
  }
  # A leftover started by hand (npm run dev / npm start) holds the same port.
  $left = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($owner in $left) {
    $command = (Get-CimInstance Win32_Process -Filter "ProcessId = $owner").CommandLine
    if ($command -match 'node') { Stop-Tree $owner } else { Say "El puerto $port lo usa otro programa ($owner); no lo toco." }
  }
  Say "$name apagado."
}

$dockerUp = $false
docker info *> $null
if ($LASTEXITCODE -eq 0) { $dockerUp = $true }
if ($dockerUp) {
  docker compose -f (Join-Path $root 'infra/local/docker-compose.yml') --env-file (Join-Path $root 'infra/local/.env') down *> $null
  Say 'Base de datos y PostgREST apagados. Los datos se conservan.'
} else {
  Say 'Docker no estaba encendido: no hay contenedores que apagar.'
}
Write-Host ''
Write-Host '  Todo apagado. Docker Desktop sigue abierto; cierralo desde su icono si quieres liberar memoria.'
