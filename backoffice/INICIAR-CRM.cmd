@echo off
setlocal
cd /d "%~dp0"
set "PATH=%~dp0.tools\node-v24.22.2-win-x64;%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%PATH%"
echo Iniciando Atomic CRM con Supabase local...
where docker >nul 2>&1
if errorlevel 1 goto no_docker
docker info >nul 2>&1
if errorlevel 1 goto docker_detained
call npx --yes supabase start
if errorlevel 1 goto error_backend
echo.
echo Abre http://localhost:5173/ y crea tu primer usuario.
echo Manten esta ventana abierta mientras uses el CRM.
echo Para detener la aplicacion presiona Ctrl+C.
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
pause
exit /b
:no_docker
echo Docker no esta instalado o no esta disponible en PATH.
echo Instala y abre Docker Desktop antes de continuar.
pause
exit /b 1
:docker_detained
echo Docker Desktop no esta iniciado. Abrelo y vuelve a intentar.
pause
exit /b 1
:error_backend
echo No se pudo iniciar Supabase. Revisa el mensaje anterior.
pause
exit /b 1
