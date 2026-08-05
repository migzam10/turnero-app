@echo off
setlocal enabledelayedexpansion
title Instalar extensiones - Turnero (terminal)

REM ============================================================
REM  Fuerza la instalacion de las DOS extensiones del Turnero
REM  (Biofile-Sync y Biofile-Injector) en Chrome y Edge de ESTE
REM  PC, via politicas de registro. Quedan fijas (no se pueden
REM  quitar), se reinstalan solas y se actualizan desde el servidor.
REM  Ejecutar en CADA PC de admisiones, como administrador.
REM ============================================================

set "ID_SYNC=ecgjdgihieabgheihfahojkoapopjkjj"
set "ID_INJ=bjogofdcbpmglacnhnbkbphkbomhnkdl"

REM --- Pedir permisos de administrador (registro HKLM) ---
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo    INSTALAR EXTENSIONES TURNERO - PC TERMINAL
echo ============================================================
echo.
echo Escribe la IP y el puerto del SERVIDOR turnero.
echo Ejemplo:  192.168.1.100:3000
echo.
:ask_server
set "SERVER="
set /p "SERVER=Servidor (IP:PUERTO): "
if not defined SERVER goto ask_server

set "UPDURL=http://!SERVER!/updates.xml"
set "SRCVAL=http://!SERVER!/*"

for %%B in (
    "HKLM\SOFTWARE\Policies\Google\Chrome"
    "HKLM\SOFTWARE\Policies\Microsoft\Edge"
) do (
    echo Configurando %%~nxB ...
    reg add "%%~B\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "!ID_SYNC!;!UPDURL!" /f >nul
    reg add "%%~B\ExtensionInstallForcelist" /v 2 /t REG_SZ /d "!ID_INJ!;!UPDURL!"  /f >nul
    reg add "%%~B\ExtensionInstallSources"   /v 1 /t REG_SZ /d "!SRCVAL!"           /f >nul
)

echo.
echo ============================================================
echo    LISTO  -  apuntando a  !UPDURL!
echo ============================================================
echo  IMPORTANTE:
echo   1. Cierra COMPLETAMENTE Chrome y Edge (todas las ventanas)
echo      y vuelve a abrirlos. Las extensiones aparecen solas en
echo      unos segundos (hasta 1-2 min la primera vez).
echo   2. El servidor turnero debe estar encendido y tener en su
echo      carpeta 'public':  biofile-sync.crx, biofile-injector.crx
echo      y updates.xml.
echo   3. Verifica en chrome://extensions o edge://extensions que
echo      aparecen las 2, "instaladas por una politica de empresa".
echo ============================================================
echo.
pause
exit /b 0
