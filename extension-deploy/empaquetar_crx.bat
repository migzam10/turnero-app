@echo off
setlocal enabledelayedexpansion
title Empaquetar extensiones (.crx) - Turnero

REM ============================================================
REM  Genera biofile-sync.crx y biofile-injector.crx a partir de
REM  ..\extension\Biofile-Sync y ..\extension\Biofile-Injector,
REM  firmadas con sus llaves .pem (esta carpeta).
REM  Se ejecuta UNA vez en tu PC (no en los terminales).
REM  Requiere Chrome o Edge, y haber creado el config.js de cada
REM  extension (ver LEEME_EXTENSION.txt, Parte 1).
REM ============================================================

cd /d "%~dp0"

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
echo.

call :pack "Biofile-Sync"     "biofile-sync.crx"
call :pack "Biofile-Injector" "biofile-injector.crx"

echo.
echo [OK] Copia estos 3 archivos a la carpeta 'public' del servidor:
echo      biofile-sync.crx   biofile-injector.crx   updates.xml
echo Y edita updates.xml reemplazando __SERVIDOR__ por IP:PUERTO.
goto :fin

REM --- Subrutina: empaqueta %~1 (carpeta) y renombra el .crx a %~2 ---
:pack
set "DIR=%~dp0..\extension\%~1"
set "PEM=%~dp0%~1.pem"
if not exist "%DIR%\manifest.json" (
    echo [ERROR] Falta %DIR%\manifest.json
    exit /b
)
if not exist "%PEM%" (
    echo [ERROR] Falta la llave de firma:  %PEM%
    exit /b
)
echo Empaquetando %~1 ...
"!BROWSER!" --pack-extension="%DIR%" --pack-extension-key="%PEM%"
REM Chrome/Edge generan <carpeta>.crx junto a la carpeta
set "GEN=%~dp0..\extension\%~1.crx"
if exist "%GEN%" (
    move /Y "%GEN%" "%~dp0%~2" >nul
    echo   [OK] %~2
) else (
    echo   [ADVERTENCIA] no se genero el .crx de %~1 (mira si hubo error arriba)
)
exit /b

:fin
echo.
pause
exit /b 0
