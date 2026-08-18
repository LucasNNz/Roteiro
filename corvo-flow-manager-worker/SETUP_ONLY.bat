@echo off
setlocal
cd /d "%~dp0"
title CORVO FLOW MANAGER - Verificar dependencias
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_dependencies.ps1"
echo.
pause
