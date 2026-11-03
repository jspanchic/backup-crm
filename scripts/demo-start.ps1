<#
.SYNOPSIS
  Starts the whole local demo: Docker (database + PostgREST), demo data, core-api and the panel, then opens the browser.
  Called by INICIAR-DEMO.cmd. Loopback only; nothing is published. Safe to run twice: it reuses what is already up.
.PARAMETER Reset
  Deletes the local development data first, so the demo starts from the seed alone ("INICIAR-DEMO.cmd limpio").
#>
param([switch]$Reset)
# Native tools (docker, npm) write progress to stderr; in Windows PowerShell 5.1 that would abort the script under 'Stop'.
# Every failure that matters is checked explicitly below.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$state = Join-Path $root '.demo'
$panelUrl = 'http://127.0.0.1:5173/'
$apiUrl = 'http://127.0.0.1:3000/healthz'
New-Item -ItemType Directory -Force $state | Out-Null

function Say([string]$text) { Write-Host "[demo] $text" }

# Node 24: the copy in .tools of this checkout, then the one next to the shared .git, then the one on PATH.
function Find-Node {
  $common = (git -C $root rev-parse --git-common-dir).Trim()
  # The path may be relative to the root or absolute: Combine keeps an absolute second part as it is.
  $sharedRoot = Split-Path ([IO.Path]::GetFullPath([IO.Path]::Combine($root, $common))) -Parent
  foreach ($base in @((Join-Path $root '.tools'), (Join-Path $sharedRoot '.tools'))) {
    $found = Get-ChildItem $base -Directory -Filter 'node-v24*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath -and (& $onPath.Source --version) -like 'v24*') { return Split-Path $onPath.Source -Parent }
  throw 'No encuentro Node 24. Debe estar en .tools\node-v24* (ver docs/DESARROLLO.md).'
}

function Wait-Until([string]$what, [int]$seconds, [scriptblock]$test) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $test) { return }
    Start-Sleep -Milliseconds 800
  }
  throw "Se acabo el tiempo esperando: $what."
}

function Test-Url([string]$url) {
  try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3).StatusCode -lt 500 } catch { return $false }
}

function Test-Port([int]$port) {
  [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

# Runs a command, shows its output only if it fails.
function Step([string]$label, [scriptblock]$command) {
  Say $label
  $output = & $command 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $output; throw "Fallo: $label" }
}

$nodeDir = Find-Node
$env:PATH = "$nodeDir;$env:PATH"
Say "Node: $nodeDir"

# 1. Docker Desktop
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Say 'Docker no esta encendido. Lo enciendo (puede tardar un par de minutos)...'
  $dockerBin = (Get-Command docker -ErrorAction SilentlyContinue).Source
  $desktop = if ($dockerBin) { Join-Path (Split-Path $dockerBin -Parent) '..\..\Docker Desktop.exe' } else { "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe" }
  if (-not (Test-Path $desktop)) { throw 'No encuentro Docker Desktop. Instalalo o abrelo a mano y vuelve a intentar.' }
  Start-Process $desktop
  Wait-Until 'que Docker responda' 240 { docker info *> $null; $LASTEXITCODE -eq 0 }
}

# 2. Database and PostgREST
$core = Join-Path $root 'core-api'
Set-Location $core
$npm = Join-Path $nodeDir 'npm.cmd'
if ($Reset) {
  # Only the local development database goes: it is rebuilt from the migrations and the demo seed just below.
  Say 'Borrando los datos locales para partir de cero...'
  & (Join-Path $PSScriptRoot 'demo-stop.ps1') *> $null
  docker compose -f ../infra/local/docker-compose.yml --env-file ../infra/local/.env down -v *> $null
}
Step 'Preparando claves locales (no se muestran)' { & $npm run --silent local:init }
Step 'Encendiendo la base de datos' { & $npm run --silent local:up }
Wait-Until 'que la base de datos acepte conexiones' 90 {
  docker compose -f ../infra/local/docker-compose.yml --env-file ../infra/local/.env exec -T db pg_isready -U postgres *> $null
  $LASTEXITCODE -eq 0
}
Step 'Creando roles y base' { & $npm run --silent db:bootstrap }
Step 'Aplicando migraciones' { & $npm run --silent db:migrate }
Step 'Cargando datos base' { & $npm run --silent db:seed }
Step 'Cargando datos de demostracion (ficticios)' { & $npm run --silent db:seed-demo }

# 3. core-api and the panel, as background processes with their own logs
# The process is created through WMI, not Start-Process: Start-Process makes the child inherit the pipe that
# carries this script's output, so anything that reads that output (a pipeline, a log capture) would wait for
# the servers to exit. WMI starts it detached, with no inherited handles. Its environment is not ours, so
# PATH and the variables it needs go into the command line.
function Start-Background([string]$name, [string]$dir, [string[]]$arguments, [int]$port, [hashtable]$variables = @{}) {
  if (Test-Port $port) { Say "$name ya estaba encendido (puerto $port)."; return }
  $set = ($variables.GetEnumerator() | ForEach-Object { "set `"$($_.Key)=$($_.Value)`" && " }) -join ''
  $log = Join-Path $state "$name.log"
  $errorLog = Join-Path $state "$name.err.log"
  $inner = "set `"PATH=$nodeDir;%PATH%`" && $set`"$nodeDir\node.exe`" $($arguments -join ' ') > `"$log`" 2> `"$errorLog`""
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = "cmd.exe /d /s /c `"$inner`""
    CurrentDirectory = $dir
  }
  if ($created.ReturnValue -ne 0) { throw "No se pudo encender $name (codigo $($created.ReturnValue))." }
  Set-Content -Path (Join-Path $state "$name.pid") -Value $created.ProcessId
  Say "$name encendido (proceso $($created.ProcessId))."
}

Start-Background 'core-api' $core @('--env-file=../infra/local/.env', '--env-file=../infra/local/demo.env', 'src/server.ts') 3000
Wait-Until 'que core-api responda' 60 { Test-Url $apiUrl }

Start-Background 'panel' (Join-Path $root 'backoffice') @('node_modules/vite/bin/vite.js', '--force', '--host', '127.0.0.1', '--port', '5173', '--strictPort') 5173 @{ VITE_DATA_PROVIDER = 'core-api' }
Wait-Until 'que el panel responda' 120 { Test-Url $panelUrl }

Say 'Todo listo. Abriendo el panel en el navegador.'
Start-Process $panelUrl
Write-Host ''
Write-Host "  Panel:    $panelUrl"
Write-Host '  Para apagar todo: DETENER-DEMO.cmd'
Write-Host '  Para correr el guion automatico: docs/GUIA_VISUAL.md, seccion "npm run demo".'
