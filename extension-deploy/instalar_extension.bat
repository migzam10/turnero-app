@echo off
setlocal enabledelayedexpansion
title Instalar extension - Turnero CertiMedic (terminal)

REM ============================================================
REM  Fuerza la instalacion de la extension Turnero CertiMedic en
REM  Chrome y Edge de ESTE PC terminal, via politicas de registro.
REM  La extension queda fija (no se puede quitar) y se reinstala
REM  sola si la borran. Se actualiza desde el servidor turnero.
REM  Ejecutar en CADA PC terminal de admisiones, como administrador.
REM ============================================================

set "EXTID=cnjjkmpamkklleaplpjhompomkbilcag"

REM --- Pedir permisos de administrador (registro HKLM) ---
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo    INSTALAR EXTENSION TURNERO - PC TERMINAL
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
set "FORCEVAL=!EXTID!;!UPDURL!"
set "SRCVAL=http://!SERVER!/*"

echo.
echo Configurando Google Chrome...
reg add "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "!FORCEVAL!" /f >nul
reg add "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallSources"   /v 1 /t REG_SZ /d "!SRCVAL!"   /f >nul

echo Configurando Microsoft Edge...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "!FORCEVAL!" /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallSources"   /v 1 /t REG_SZ /d "!SRCVAL!"   /f >nul

echo.
echo ============================================================
echo    LISTO
echo ============================================================
echo  Extension forzada apuntando a:  !UPDURL!
echo.
echo  IMPORTANTE:
echo   1. Cierra COMPLETAMENTE Chrome y Edge (todas las ventanas)
echo      y vuelve a abrirlos. La extension aparecera sola en unos
echo      segundos (puede tardar hasta 1-2 min la primera vez).
echo   2. El servidor turnero debe estar encendido y debe tener
echo      turnero.crx y updates.xml en su carpeta 'public'.
echo   3. Verifica en chrome://extensions o edge://extensions que
echo      aparece "Turnero CertiMedic" instalada por politica.
echo ============================================================
echo.
pause
exit /b 0
