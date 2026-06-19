@echo off
setlocal
title Quitar extension - Turnero CertiMedic (terminal)

REM ============================================================
REM  Quita las politicas que fuerzan la extension en este PC.
REM  Ejecutar como administrador.
REM ============================================================

net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo Quitando politicas de Chrome...
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallSources"   /v 1 /f >nul 2>&1

echo Quitando politicas de Edge...
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallSources"   /v 1 /f >nul 2>&1

echo.
echo [OK] Politicas quitadas. Reinicia Chrome/Edge para que la
echo      extension desaparezca.
echo.
pause
exit /b 0
