@echo off
setlocal enabledelayedexpansion
title Empaquetar extension (.crx) - Turnero CertiMedic

REM ============================================================
REM  Genera turnero.crx a partir de la carpeta ..\extension
REM  usando la llave de firma turnero_extension.pem.
REM  Se ejecuta UNA sola vez en tu PC (no en los terminales).
REM  Requiere tener Chrome o Edge instalado.
REM ============================================================

cd /d "%~dp0"
set "EXT_DIR=%~dp0..\extension"
set "KEY=%~dp0turnero_extension.pem"

if not exist "%EXT_DIR%\manifest.json" (
    echo [ERROR] No se encuentra la carpeta de la extension en:
    echo    %EXT_DIR%
    goto :fin
)
if not exist "%KEY%" (
    echo [ERROR] No se encuentra la llave de firma:
    echo    %KEY%
    goto :fin
)

REM --- Buscar Chrome o Edge ---
set "BROWSER="
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
    "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
    if not defined BROWSER if exist "%%~P" set "BROWSER=%%~P"
)
if not defined BROWSER (
    echo [ERROR] No se encontro Chrome ni Edge para empaquetar.
    goto :fin
)
echo Usando: !BROWSER!

echo Empaquetando...
"!BROWSER!" --pack-extension="%EXT_DIR%" --pack-extension-key="%KEY%"

REM Chrome/Edge generan el .crx junto a la carpeta, con el nombre de la carpeta (extension.crx)
set "GEN_CRX=%~dp0..\extension.crx"
if exist "%GEN_CRX%" (
    move /Y "%GEN_CRX%" "%~dp0turnero.crx" >nul
    echo.
    echo [OK] Generado:  %~dp0turnero.crx
    echo.
    echo SIGUIENTE PASO: copia turnero.crx y updates.xml a la carpeta
    echo 'public' del servidor (donde quedo instalado el turnero), y
    echo edita updates.xml reemplazando __SERVIDOR__ por IP:PUERTO.
) else (
    echo [ADVERTENCIA] No se encontro el .crx generado. Revisa si el
    echo navegador mostro algun error arriba.
)

:fin
echo.
pause
exit /b 0
