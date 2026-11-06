@echo off
rem Runs only the tests of the CRM-T6 bot tools, one line per test. The work is in scripts\pruebas-t6.ps1.
title Salvionix - pruebas de las herramientas T6
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pruebas-t6.ps1"
echo.
pause
