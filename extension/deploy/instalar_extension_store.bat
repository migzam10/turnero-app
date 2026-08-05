@echo off
setlocal enabledelayedexpansion
title Instalar extensiones Turnero (Chrome Web Store) - terminal

REM ============================================================
REM  Fuerza la instalacion de las DOS extensiones del Turnero
REM  DESDE LA CHROME WEB STORE (publicadas como "No listada").
REM
REM  Ventaja vs. la version .crx local:
REM   - Funciona en PCs NO administrados (Chrome solo permite
REM     force-install de la Web Store en equipos sueltos).
REM   - Sobrevive reinicios; Chrome las re-descarga solo.
REM   - Es el MISMO .bat para TODAS las clinicas/IPS: no lleva
REM     IP ni secreto. Cada terminal pone su servidor y su clave
REM     en el ENGRANAJE del popup de cada extension.
REM
REM  Ejecutar en CADA PC de admisiones, como administrador.
REM ============================================================

set "ID_SYNC=ojgcieginkkhnefpmigmpfkmonbkhlkd"
set "ID_INJ=emhmednejidoeomnikajijlccoapchgl"
set "UPD=https://clients2.google.com/service/update2/crx"

REM --- Pedir permisos de administrador (registro HKLM) ---
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo    INSTALAR EXTENSIONES TURNERO (Web Store) - TERMINAL
echo ============================================================
echo.
echo Se instalan las 2 extensiones desde la Chrome Web Store.
echo NO se pide IP ni secreto aqui: eso se configura despues en
echo el engranaje del popup de cada extension, en este PC.
echo.

for %%B in (
    "HKLM\SOFTWARE\Policies\Google\Chrome"
    "HKLM\SOFTWARE\Policies\Microsoft\Edge"
) do (
    echo Configurando %%~nxB ...
    reg add "%%~B\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "!ID_SYNC!;!UPD!" /f >nul
    reg add "%%~B\ExtensionInstallForcelist" /v 2 /t REG_SZ /d "!ID_INJ!;!UPD!"  /f >nul
)

echo.
echo ============================================================
echo    LISTO
echo ============================================================
echo  1. Cierra COMPLETAMENTE Chrome y Edge (todas las ventanas)
echo     y vuelve a abrirlos. Las 2 extensiones aparecen solas
echo     (hasta 1-2 min la primera vez), instaladas por politica.
echo.
echo  2. En cada extension: abre su popup y toca el ENGRANAJE de
echo     "Conexion". Pon el SERVIDOR (IP:PUERTO de ESTA clinica)
echo     y el EXTENSION_SECRET. Guarda. Eso queda en este PC.
echo.
echo  3. Deja abierta en Biofile la pestana de
echo     AtencionesSeguimiento.aspx para que el Sync trabaje.
echo ============================================================
echo.
pause
exit /b 0
