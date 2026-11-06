<#
.SYNOPSIS
  Runs only the tests of the CRM-T6 bot tools (core-api/test/tools.test.ts) with one line per test and its mark.
  Needs the presentation (or the local stack) up, because the tests use the real database. Called by PRUEBAS-T6.cmd.
#>
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$common = (git -C $root rev-parse --git-common-dir).Trim()
$sharedRoot = Split-Path ([IO.Path]::GetFullPath([IO.Path]::Combine($root, $common))) -Parent
$nodeDir = $null
foreach ($base in @((Join-Path $root '.tools'), (Join-Path $sharedRoot '.tools'))) {
  $found = Get-ChildItem $base -Directory -Filter 'node-v24*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $nodeDir = $found.FullName; break }
}
if (-not $nodeDir) { throw 'No encuentro Node 24. Debe estar en .tools\node-v24* (ver docs/DESARROLLO.md).' }
$env:PATH = "$nodeDir;$env:PATH"
Set-Location (Join-Path $root 'core-api')
& (Join-Path $nodeDir 'npm.cmd') run test:t6
exit $LASTEXITCODE
