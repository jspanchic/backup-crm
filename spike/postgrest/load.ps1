# CRM-T1 spike: rebuild the local spike database from scratch.
# Usage: powershell -File spike/postgrest/load.ps1 -EnvFile <path-outside-repo>\spike.env [-Seed]
param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [switch]$Seed
)
$ErrorActionPreference = 'Continue'  # docker compose writes progress to stderr
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$u8 = New-Object Text.UTF8Encoding($false)
$apw = ((Get-Content $EnvFile) | Select-String '^AUTHENTICATOR_PASSWORD=').Line.Split('=')[1]
$compose = "$PSScriptRoot\docker-compose.yml"

docker compose -f $compose --env-file $EnvFile down -v | Out-Null
docker compose -f $compose --env-file $EnvFile up -d db | Out-Null
for ($i = 0; $i -lt 30; $i++) { docker exec crm-spike-db-1 pg_isready -U postgres *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 1 }

function Invoke-Sql([string]$file, [string]$dropPattern) {
  $text = [IO.File]::ReadAllText($file, $u8)
  if ($dropPattern) { $text = ($text -split "`n" | Where-Object { $_ -notmatch $dropPattern }) -join "`n" }
  $out = $text | docker exec -i crm-spike-db-1 psql -U postgres -v ON_ERROR_STOP=1 -v "authenticator_password=$apw" -q 2>&1
  if ($LASTEXITCODE -ne 0) { throw "SQL failed in ${file}: $($out | Select-Object -First 6)" }
}

Invoke-Sql "$PSScriptRoot\00_stub.sql" $null
foreach ($f in '01_tables', '02_functions', '03_views', '04_triggers', '05_policies', '06_grants', '07_storage', '08_search') {
  # the stock postgres image has no "http" extension; the stub provides extensions.http_get instead
  Invoke-Sql "$root\supabase\schemas\$f.sql" 'create extension if not exists "http"'
}
Invoke-Sql "$PSScriptRoot\90_roles.sql" $null
if ($Seed) { Invoke-Sql "$PSScriptRoot\95_seed.sql" $null }
docker compose -f $compose --env-file $EnvFile up -d api | Out-Null
Write-Host 'spike database loaded'