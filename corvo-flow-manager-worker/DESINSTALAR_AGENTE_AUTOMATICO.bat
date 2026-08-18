@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall_agent.ps1"
echo.
echo Auto-start e protocolo corvoflow:// removidos.
echo Perfis/logins em %LOCALAPPDATA%\CorvoFlowManager NAO foram apagados.
pause
