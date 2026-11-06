@echo off
rem Runs the live flow of the presentation, step by step. The work is in scripts\demo-flujo.ps1.
rem "FLUJO-PRESENTACION.cmd detalle" also shows every call of the bot (method, path, body and answer), secrets hidden.
title Salvionix - flujo en vivo
set "DETAIL="
if /i "%~1"=="detalle" set "DETAIL=-Detalle"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo-flujo.ps1" %DETAIL%
echo.
pause
