@echo off
rem Stops the presentation. The work is in scripts\presentacion-stop.ps1.
rem "DETENER-PRESENTACION.cmd borrar" also deletes the presentation volume (never the regular demo's).
title Salvionix - detener presentacion
set "WIPE="
if /i "%~1"=="borrar" set "WIPE=-Borrar"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\presentacion-stop.ps1" %WIPE%
echo.
pause
