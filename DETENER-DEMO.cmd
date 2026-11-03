@echo off
rem Stops the local demo. The work is in scripts\demo-stop.ps1.
title Salvionix - detener demo
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo-stop.ps1"
echo.
pause
