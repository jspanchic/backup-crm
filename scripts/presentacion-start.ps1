<#
.SYNOPSIS
  Starts the presentation: its own Docker project (salvionix-presentacion, with its own volume), the presentation
  data, core-api and the panel with PRESENTATION_MODE on. Called by INICIAR-PRESENTACION.cmd. Loopback only.
  It never uses the volume of the regular demo (salvionix-local_db-data).
.PARAMETER Reset
  Empties what customers and the bot created and loads the presentation data again ("INICIAR-PRESENTACION.cmd limpio").
#>
param([switch]$Reset)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$state = Join-Path $root '.demo'
$project = 'salvionix-presentacion'
$composeFile = Join-Path $root 'infra/local/docker-compose.yml'
$envFile = Join-Path $root 'infra/local/.env'
$panelUrl = 'http://127.0.0.1:5173/'
$apiUrl = 'http://127.0.0.1:3000/healthz'
New-Item -ItemType Directory -Force $state | Out-Null

function Say([string]$text) { Write-Host "[presentacion] $text" }

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

function Step([string]$label, [scriptblock]$command) {
  Say $label
  $output = & $command 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $output; throw "Fallo: $label" }
}

function Compose { docker compose -p $project -f $composeFile --env-file $envFile @args }

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

# 2. The ports are fixed: if the regular demo is up, ask to stop it instead of touching it.
$ours = (Compose ps -q db 2>$null | Out-String).Trim()
if (-not $ours) {
  foreach ($port in 55432, 55300) {
    if (Test-Port $port) { throw "El puerto $port ya esta en uso (probablemente la demo normal). Apagala con DETENER-DEMO.cmd y vuelve a intentar." }
  }
}

$core = Join-Path $root 'core-api'
Set-Location $core
$npm = Join-Path $nodeDir 'npm.cmd'
Step 'Preparando claves locales (no se muestran)' { & $npm run --silent local:init }
Step 'Encendiendo la base de datos y el motor de PDF de la presentacion' { Compose up -d db api gotenberg }
Wait-Until 'que la base de datos acepte conexiones' 90 {
  Compose exec -T db pg_isready -U postgres *> $null
  $LASTEXITCODE -eq 0
}
Step 'Creando roles y base' { & $npm run --silent db:bootstrap }
Step 'Aplicando migraciones' { & $npm run --silent db:migrate }
Step 'Cargando datos base' { & $npm run --silent db:seed }
# The PDFs of the presentation data are made while seeding, so the PDF engine has to be answering by then.
try { Wait-Until 'que el motor de PDF responda' 120 { Test-Url 'http://127.0.0.1:53000/health' } }
catch { Say 'El motor de PDF no respondio: los documentos se generaran desde el panel cuando este encendido.' }
if ($Reset) {
  Step 'Reiniciando los datos de la presentacion' { & $npm run --silent db:seed-presentacion -- --reset --yes-presentation-db }
} else {
  Step 'Cargando datos de la presentacion (ficticios)' { & $npm run --silent db:seed-presentacion }
}
Wait-Until 'que PostgREST responda' 60 { Test-Url 'http://127.0.0.1:55300/' }

# 3. core-api and the panel, detached, with their own logs (see demo-start.ps1 for why WMI)
function Start-Background([string]$name, [string]$dir, [string[]]$arguments, [int]$port, [hashtable]$variables = @{}) {
  if (Test-Port $port) { Say "$name ya estaba encendido (puerto $port)."; return }
  $set = ($variables.GetEnumerator() | ForEach-Object { "set `"$($_.Key)=$($_.Value)`" && " }) -join ''
  $log = Join-Path $state "pres-$name.log"
  $errorLog = Join-Path $state "pres-$name.err.log"
  $inner = "set `"PATH=$nodeDir;%PATH%`" && $set`"$nodeDir\node.exe`" $($arguments -join ' ') > `"$log`" 2> `"$errorLog`""
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = "cmd.exe /d /s /c `"$inner`""
    CurrentDirectory = $dir
  }
  if ($created.ReturnValue -ne 0) { throw "No se pudo encender $name (codigo $($created.ReturnValue))." }
  Set-Content -Path (Join-Path $state "pres-$name.pid") -Value $created.ProcessId
  Say "$name encendido (proceso $($created.ProcessId))."
}

Start-Background 'core-api' $core @('--env-file=../infra/local/.env', '--env-file=../infra/local/demo.env', 'src/server.ts') 3000
Wait-Until 'que core-api responda' 60 { Test-Url $apiUrl }

Start-Background 'panel' (Join-Path $root 'backoffice') @('node_modules/vite/bin/vite.js', '--force', '--host', '127.0.0.1', '--port', '5173', '--strictPort') 5173 @{ VITE_DATA_PROVIDER = 'core-api'; VITE_PRESENTATION_MODE = 'true' }
Wait-Until 'que el panel responda' 120 { Test-Url $panelUrl }

Say 'Todo listo. Abriendo el panel en el navegador.'
Start-Process $panelUrl
Write-Host ''
Write-Host "  Panel:           $panelUrl"
Write-Host '  Flujo en vivo:   powershell -File scripts\demo-flujo.ps1   (o doble clic en FLUJO-PRESENTACION.cmd)'
Write-Host '  Para apagar:     DETENER-PRESENTACION.cmd'
