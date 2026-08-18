@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\CorvoFlowAgent\V4_2_9_APP"

echo ============================================================
echo   CORVO FLOW AGENT - INSTALACAO AUTOMATICA
echo ============================================================
echo.
echo Instalacao unica. Depois disso o Roteiro inicia e usa o Flow
echo sem voce abrir o Manager manualmente.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_agent.ps1" -SourceDir "%SRC%" -DestinationDir "%DEST%"
if errorlevel 1 (
  echo.
  echo [ERRO] O agente automatico nao foi instalado.
  pause
  exit /b 1
)

echo.
echo [OK] Corvo Flow Agent instalado e iniciado em segundo plano.
echo [OK] Ele tambem iniciara automaticamente com o Windows.
echo [OK] O Roteiro pode acorda-lo por corvoflow://start.
echo.
echo Seus perfis/logins continuam preservados em:
echo %LOCALAPPDATA%\CorvoFlowManager
echo.
pause
exit /b 0
