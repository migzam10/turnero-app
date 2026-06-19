@echo off
setlocal enabledelayedexpansion
title Instalador - Turnero CertiMedic

REM ============================================================
REM  Instalador del servidor Turnero CertiMedic
REM  Windows Server 2019 / Windows 10+
REM  Requisitos previos (instalar a mano si faltan):
REM    - Node.js 20 LTS  (https://nodejs.org)
REM    - PostgreSQL 16   (https://www.postgresql.org/download/windows/)
REM  Y copiar nssm.exe junto a este .bat (https://nssm.cc/download)
REM ============================================================

REM --- 1. Pedir permisos de administrador (necesarios para servicio y firewall) ---
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
set "INSTALLER_DIR=%~dp0"
set "SRC_APP=%~dp0..\app"

echo ============================================================
echo    INSTALADOR - TURNERO CERTIMEDIC
echo ============================================================
echo.

REM --- 2. Verificar Node.js ---
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado o no esta en el PATH.
    echo Instala Node.js 20 LTS desde https://nodejs.org y vuelve a ejecutar.
    goto :fin_error
)
for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i"
echo [OK] Node.js encontrado: !NODE_EXE!

REM --- 3. Verificar PostgreSQL (psql) ---
set "PSQL="
where psql >nul 2>&1 && for /f "delims=" %%i in ('where psql') do set "PSQL=%%i"
if not defined PSQL (
    for %%v in (17 16 15 14) do (
        if exist "C:\Program Files\PostgreSQL\%%v\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\%%v\bin\psql.exe"
    )
)
if not defined PSQL (
    echo [ERROR] No se encontro psql ^(PostgreSQL^). Instala PostgreSQL 16 y reintenta.
    goto :fin_error
)
echo [OK] PostgreSQL encontrado: !PSQL!

REM --- 4. Verificar NSSM ---
set "NSSM=%INSTALLER_DIR%nssm.exe"
if not exist "%NSSM%" (
    echo [ERROR] Falta nssm.exe junto a este instalador.
    echo Descarga NSSM de https://nssm.cc/download y copia nssm.exe aqui:
    echo    %INSTALLER_DIR%
    goto :fin_error
)
echo [OK] NSSM encontrado.

REM --- 5. Verificar codigo fuente de la app ---
if not exist "%SRC_APP%\server.js" (
    echo [ERROR] No se encuentra la carpeta 'app' con el codigo en:
    echo    %SRC_APP%
    goto :fin_error
)
echo [OK] Codigo fuente encontrado.
echo.

REM --- 6. Recoger configuracion (Enter = valor por defecto entre corchetes) ---
echo ------------------------------------------------------------
echo  CONFIGURACION (pulsa Enter para aceptar el valor por defecto)
echo ------------------------------------------------------------
set "INSTALL_DIR=C:\turnero-certimedic"
set /p "INSTALL_DIR=Carpeta de instalacion [!INSTALL_DIR!]: "
set "PORT=3000"
set /p "PORT=Puerto del servidor [!PORT!]: "
set "DB_NAME=turnero"
set /p "DB_NAME=Nombre de la base de datos [!DB_NAME!]: "
set "DB_USER=turnero_user"
set /p "DB_USER=Usuario de la base de datos [!DB_USER!]: "

:ask_dbpass
set "DB_PASSWORD="
set /p "DB_PASSWORD=Password para el usuario !DB_USER! (REQUERIDO): "
if not defined DB_PASSWORD goto ask_dbpass

:ask_pgpass
set "PG_SUPERPASS="
set /p "PG_SUPERPASS=Password del superusuario 'postgres' (REQUERIDO): "
if not defined PG_SUPERPASS goto ask_pgpass

set "EXTENSION_SECRET=CertiMedicTurnero2026"
set /p "EXTENSION_SECRET=Secreto compartido con la extension Chrome [!EXTENSION_SECRET!]: "
set "ADMIN_USER=admin"
set /p "ADMIN_USER=Usuario del panel admin [!ADMIN_USER!]: "
set "ADMIN_PASSWORD=admin"
set /p "ADMIN_PASSWORD=Password del panel admin [!ADMIN_PASSWORD!]: "

echo.
echo ------------------------------------------------------------
echo  RESUMEN
echo    Carpeta:    !INSTALL_DIR!
echo    Puerto:     !PORT!
echo    Base datos: !DB_NAME!  (usuario: !DB_USER!)
echo    Servicio:   Turnero (Windows)
echo ------------------------------------------------------------
choice /C SN /M "Continuar con la instalacion"
if errorlevel 2 goto :fin_cancel

REM --- 7. Copiar archivos de la app (sin node_modules) ---
echo.
echo [1/6] Copiando archivos...
if not exist "!INSTALL_DIR!" mkdir "!INSTALL_DIR!"
robocopy "%SRC_APP%" "!INSTALL_DIR!" /E /XD node_modules .git /XF .DS_Store Dockerfile >nul
if %errorlevel% GEQ 8 (
    echo [ERROR] Fallo la copia de archivos.
    goto :fin_error
)
if not exist "!INSTALL_DIR!\logs" mkdir "!INSTALL_DIR!\logs"

REM --- 8. Generar archivo .env (via PowerShell para evitar problemas de caracteres) ---
echo [2/6] Generando configuracion (.env)...
set "ENV_PATH=!INSTALL_DIR!\.env"
powershell -NoProfile -Command "$l=@('PORT='+$env:PORT,'NODE_ENV=production','EXTENSION_SECRET='+$env:EXTENSION_SECRET,'ADMIN_USER='+$env:ADMIN_USER,'ADMIN_PASSWORD='+$env:ADMIN_PASSWORD,'DB_HOST=localhost','DB_PORT=5432','DB_NAME='+$env:DB_NAME,'DB_USER='+$env:DB_USER,'DB_PASSWORD='+$env:DB_PASSWORD); Set-Content -Path $env:ENV_PATH -Value $l -Encoding ASCII"

REM --- 9. Instalar dependencias de Node ---
echo [3/6] Instalando dependencias (npm)... esto puede tardar.
pushd "!INSTALL_DIR!"
call npm install --omit=dev
set "NPMERR=%errorlevel%"
popd
if not "%NPMERR%"=="0" (
    echo [ADVERTENCIA] 'npm install' fallo (revisa la conexion a internet).
    echo Puedes copiar la carpeta node_modules manualmente a !INSTALL_DIR! y continuar.
)

REM --- 10. Crear base de datos y usuario en PostgreSQL ---
echo [4/6] Creando base de datos y usuario...
set "SQL_PATH=!INSTALL_DIR!\__setup_db.sql"
powershell -NoProfile -Command "$pw=$env:DB_PASSWORD -replace \"'\",\"''\"; @(\"CREATE ROLE $env:DB_USER LOGIN PASSWORD '$pw';\",\"CREATE DATABASE $env:DB_NAME OWNER $env:DB_USER;\",\"GRANT ALL PRIVILEGES ON DATABASE $env:DB_NAME TO $env:DB_USER;\") | Set-Content -Path $env:SQL_PATH -Encoding ASCII"
set "PGPASSWORD=!PG_SUPERPASS!"
"%PSQL%" -U postgres -h localhost -p 5432 -d postgres -v ON_ERROR_STOP=0 -f "!SQL_PATH!"
set "PSQLERR=%errorlevel%"
set "PGPASSWORD="
del "!SQL_PATH!" >nul 2>&1
if %PSQLERR% GEQ 2 (
    echo [ERROR] No se pudo conectar a PostgreSQL.
    echo Verifica que el servicio de PostgreSQL este corriendo y que el password de 'postgres' sea correcto.
    goto :fin_error
)
echo     (si la base o el usuario ya existian, los avisos de arriba son normales)

REM --- 11. Registrar el servicio de Windows con NSSM ---
echo [5/6] Registrando el servicio de Windows...
"%NSSM%" stop Turnero >nul 2>&1
"%NSSM%" remove Turnero confirm >nul 2>&1
"%NSSM%" install Turnero "!NODE_EXE!" "!INSTALL_DIR!\server.js"
"%NSSM%" set Turnero AppDirectory "!INSTALL_DIR!"
"%NSSM%" set Turnero DisplayName "Turnero CertiMedic"
"%NSSM%" set Turnero Description "Servidor del sistema de turnos CertiMedic"
"%NSSM%" set Turnero Start SERVICE_AUTO_START
"%NSSM%" set Turnero AppStdout "!INSTALL_DIR!\logs\turnero.log"
"%NSSM%" set Turnero AppStderr "!INSTALL_DIR!\logs\turnero.log"
"%NSSM%" set Turnero AppRotateFiles 1
"%NSSM%" set Turnero AppRotateBytes 5242880
"%NSSM%" set Turnero AppExit Default Restart
"%NSSM%" start Turnero >nul 2>&1

REM --- 12. Abrir el puerto en el firewall ---
echo [6/6] Configurando el firewall...
netsh advfirewall firewall delete rule name="Turnero CertiMedic" >nul 2>&1
netsh advfirewall firewall add rule name="Turnero CertiMedic" dir=in action=allow protocol=TCP localport=!PORT! >nul

REM --- 13. Verificar que el servidor responde ---
echo.
echo Verificando el servidor (espera unos segundos)...
powershell -NoProfile -Command "Start-Sleep -Seconds 5"
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 ('http://localhost:'+$env:PORT+'/health'); if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
if errorlevel 1 (
    echo [ADVERTENCIA] El servidor aun no responde. Revisa el log:
    echo    !INSTALL_DIR!\logs\turnero.log
) else (
    echo [OK] El servidor responde correctamente.
)

echo.
echo ============================================================
echo    INSTALACION COMPLETADA
echo ============================================================
echo  Servicio de Windows: Turnero  (arranca solo al encender)
echo.
echo  URLs (desde este servidor):
echo    Recepcion:  http://localhost:!PORT!/recepcion
echo    Admisiones: http://localhost:!PORT!/admisiones
echo    Profesional http://localhost:!PORT!/profesional
echo    Display TV: http://localhost:!PORT!/display
echo    Admin:      http://localhost:!PORT!/admin
echo.
echo  Desde otros PCs: reemplaza localhost por la IP fija del servidor.
echo.
echo  RECUERDA en la extension Chrome (background.js):
echo    SERVER_URL       = http://IP_DEL_SERVIDOR:!PORT!
echo    EXTENSION_SECRET = !EXTENSION_SECRET!
echo ============================================================
goto :fin

:fin_cancel
echo.
echo Instalacion cancelada por el usuario.
goto :fin

:fin_error
echo.
echo La instalacion NO se completo. Corrige el problema y vuelve a ejecutar.
echo.
pause
exit /b 1

:fin
echo.
pause
exit /b 0
