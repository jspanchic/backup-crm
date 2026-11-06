@echo off
rem Runs the live flow of the presentation, step by step. The work is in scripts\demo-flujo.ps1.
title Salvionix - flujo en vivo
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo-flujo.ps1" %*
echo.
pause
