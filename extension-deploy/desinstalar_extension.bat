@echo off
setlocal
title Quitar extensiones - Turnero (terminal)

REM ============================================================
REM  Quita las politicas que fuerzan las 2 extensiones en este PC.
REM  Ejecutar como administrador.
REM ============================================================

net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

for %%B in (
    "HKLM\SOFTWARE\Policies\Google\Chrome"
    "HKLM\SOFTWARE\Policies\Microsoft\Edge"
) do (
    echo Quitando politicas de %%~nxB ...
    reg delete "%%~B\ExtensionInstallForcelist" /v 1 /f >nul 2>&1
    reg delete "%%~B\ExtensionInstallForcelist" /v 2 /f >nul 2>&1
    reg delete "%%~B\ExtensionInstallSources"   /v 1 /f >nul 2>&1
)

echo.
echo [OK] Politicas quitadas. Reinicia Chrome/Edge para que las
echo      extensiones desaparezcan.
echo.
pause
exit /b 0
