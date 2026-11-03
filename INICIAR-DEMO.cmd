@echo off
rem Starts the whole local demo and opens the panel. The work is in scripts\demo-start.ps1.
rem "INICIAR-DEMO.cmd limpio" deletes the local demo data first and starts from the seed alone.
title Salvionix - iniciar demo
set "RESET="
if /i "%~1"=="limpio" set "RESET=-Reset"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo-start.ps1" %RESET%
if errorlevel 1 (
  echo.
  echo Algo fallo. Lee los mensajes de arriba. Los registros estan en la carpeta .demo
  pause
  exit /b 1
)
echo.
pause
