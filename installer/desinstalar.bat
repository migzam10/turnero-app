@echo off
setlocal enabledelayedexpansion
title Desinstalador - Turnero CertiMedic

REM ============================================================
REM  Desinstalador del servidor Turnero CertiMedic
REM  Quita el servicio de Windows y la regla del firewall.
REM  NO borra los archivos ni la base de datos salvo que lo confirmes.
REM ============================================================

REM --- Pedir permisos de administrador ---
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
set "NSSM=%~dp0nssm.exe"

echo ============================================================
echo    DESINSTALADOR - TURNERO CERTIMEDIC
echo ============================================================
echo.

REM --- Quitar el servicio ---
echo Deteniendo y quitando el servicio 'Turnero'...
if exist "%NSSM%" (
    "%NSSM%" stop Turnero >nul 2>&1
    "%NSSM%" remove Turnero confirm >nul 2>&1
) else (
    sc stop Turnero >nul 2>&1
    sc delete Turnero >nul 2>&1
)
echo [OK] Servicio quitado.

REM --- Quitar la regla del firewall ---
echo Quitando la regla del firewall...
netsh advfirewall firewall delete rule name="Turnero CertiMedic" >nul 2>&1
echo [OK] Regla del firewall quitada.

echo.
set "INSTALL_DIR=C:\turnero-certimedic"
set /p "INSTALL_DIR=Carpeta donde se instalo [!INSTALL_DIR!]: "
echo.
choice /C SN /M "Borrar tambien la carpeta de archivos (!INSTALL_DIR!)"
if errorlevel 2 (
    echo Se conservan los archivos en !INSTALL_DIR!
) else (
    if exist "!INSTALL_DIR!" rmdir /S /Q "!INSTALL_DIR!"
    echo [OK] Carpeta borrada.
)

echo.
echo NOTA: La base de datos de PostgreSQL NO se borra automaticamente.
echo Si quieres eliminarla, hazlo manualmente con psql/pgAdmin:
echo    DROP DATABASE turnero;
echo    DROP ROLE turnero_user;
echo.
echo Desinstalacion finalizada.
echo.
pause
exit /b 0
