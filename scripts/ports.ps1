<#
.SYNOPSIS
  The host ports of the local stack, read from infra/local/.env (with the same defaults as the compose file), and the check
  the start scripts run before Docker tries to publish them. Dot-source it: . "$PSScriptRoot\ports.ps1"
  Windows reserves ranges of ports (they move after a restart or after Docker/Hyper-V start); Docker cannot publish a port
  inside one and the error it gives is hard to read. This says which port, and how to change it.
#>

$script:PortDefaults = [ordered]@{
  PGPORT              = @{ Default = 15432; What = 'la base de datos' }
  POSTGREST_PORT      = @{ Default = 13300; What = 'PostgREST' }
  POSTGREST_TEST_PORT = @{ Default = 13301; What = 'PostgREST de pruebas' }
  GOTENBERG_PORT      = @{ Default = 13302; What = 'el motor de PDF (Gotenberg)' }
}

function Get-LocalPorts([string]$EnvFile) {
  $found = @{}
  if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
      if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(\d+)\s*$' -and $script:PortDefaults.Contains($Matches[1])) { $found[$Matches[1]] = [int]$Matches[2] }
    }
  }
  $result = [ordered]@{}
  foreach ($name in $script:PortDefaults.Keys) {
    $result[$name] = if ($found.ContainsKey($name)) { $found[$name] } else { $script:PortDefaults[$name].Default }
  }
  return $result
}

# The ranges Windows keeps for itself, as @(@{From=..;To=..}, ...). Empty if netsh cannot be read.
function Get-ExcludedPortRanges {
  $ranges = @()
  foreach ($line in (netsh interface ipv4 show excludedportrange protocol=tcp 2>$null)) {
    if ($line -match '^\s*(\d+)\s+(\d+)') { $ranges += @{ From = [int]$Matches[1]; To = [int]$Matches[2] } }
  }
  return $ranges
}

<#
  Returns the problems found, one text each (empty = all free). A port is a problem when it is inside a range reserved by
  Windows, or when something already listens on it.
#>
function Test-LocalPorts([string]$EnvFile, [switch]$IgnoreListeners) {
  $problems = @()
  $ports = Get-LocalPorts $EnvFile
  $excluded = Get-ExcludedPortRanges
  $envName = 'infra\local\.env'
  foreach ($name in $ports.Keys) {
    $port = $ports[$name]
    $what = $script:PortDefaults[$name].What
    $hit = $excluded | Where-Object { $port -ge $_.From -and $port -le $_.To } | Select-Object -First 1
    if ($hit) {
      $problems += "El puerto $port ($name, $what) esta dentro de un rango que Windows reservo ($($hit.From)-$($hit.To)), y Docker no puede usarlo. Cambia $name en $envName por un puerto libre fuera de esos rangos (mira netsh interface ipv4 show excludedportrange protocol=tcp; por ejemplo $($script:PortDefaults[$name].Default)) y vuelve a intentar."
      continue
    }
    if (-not $IgnoreListeners) {
      $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($listener) {
        $owner = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        $problems += "El puerto $port ($name, $what) ya esta en uso$(if ($owner) { " por el proceso $owner" }). Si es la demo normal, apagala con DETENER-DEMO.cmd; si es otra cosa, cambia $name en $envName por un puerto libre y vuelve a intentar."
      }
    }
  }
  return $problems
}