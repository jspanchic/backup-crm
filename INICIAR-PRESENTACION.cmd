@echo off
rem Starts the presentation (PRESENTATION_MODE on, own Docker project). The work is in scripts\presentacion-start.ps1.
rem "INICIAR-PRESENTACION.cmd limpio" empties what customers and the bot created and loads the presentation data again.
title Salvionix - iniciar presentacion
set "RESET="
if /i "%~1"=="limpio" set "RESET=-Reset"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\presentacion-start.ps1" %RESET%
if errorlevel 1 (
  echo.
  echo Algo fallo. Lee los mensajes de arriba. Los registros estan en la carpeta .demo
  pause
  exit /b 1
)
echo.
pause
