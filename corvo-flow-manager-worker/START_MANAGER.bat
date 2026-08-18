@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title CORVO FLOW MANAGER V4.2.9 - Inicializacao automatica

echo.
echo ============================================================
echo   CORVO FLOW MANAGER V4.2.9 - AUTO SETUP / SINGLE INSTANCE
echo ============================================================
echo.
echo Verificando o ambiente antes de iniciar...
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Windows PowerShell nao foi encontrado.
  echo O inicializador automatico precisa do PowerShell do Windows.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_dependencies.ps1"
if errorlevel 1 (
  echo.
  echo [ERRO] A preparacao automatica nao foi concluida.
  echo Consulte a mensagem acima e execute START_MANAGER.bat novamente.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0.runtime\runtime.env.cmd" (
  echo [ERRO] Arquivo de runtime nao foi criado.
  pause
  exit /b 1
)

call "%~dp0.runtime\runtime.env.cmd"

if not defined CORVO_NODE_EXE (
  echo [ERRO] Node.js nao foi localizado apos a verificacao automatica.
  pause
  exit /b 1
)

if not exist "%CORVO_NODE_EXE%" (
  echo [ERRO] Node.js configurado nao existe: %CORVO_NODE_EXE%
  pause
  exit /b 1
)

if defined CORVO_CHROME_EXE set "CHROME_PATH=%CORVO_CHROME_EXE%"

echo.
echo ============================================================
echo   VERIFICANDO INSTANCIA DO MANAGER
echo ============================================================
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare_manager_port.ps1" -Port 32145 -TargetVersion "4.2.9"
set "PORT_CHECK=%ERRORLEVEL%"
if "%PORT_CHECK%"=="20" (
  echo.
  echo Manager V4.2.9 ja estava aberto. Painel reutilizado.
  timeout /t 2 /nobreak >nul
  exit /b 0
)
if not "%PORT_CHECK%"=="0" (
  echo.
  echo [ERRO] Nao foi possivel preparar a porta 32145 para o Manager.
  echo.
  pause
  exit /b %PORT_CHECK%
)

echo.
echo ============================================================
echo   AMBIENTE PRONTO
echo ============================================================
echo Node:   %CORVO_NODE_EXE%
if defined CHROME_PATH echo Chrome: %CHROME_PATH%
echo.
echo Iniciando CORVO FLOW MANAGER...
echo Painel: http://127.0.0.1:32145
echo Esta versao impede duas instancias do Manager na mesma porta.
echo.

"%CORVO_NODE_EXE%" "%~dp0manager\server.js"
set "CORVO_EXIT=%ERRORLEVEL%"

echo.
if not "%CORVO_EXIT%"=="0" echo [ERRO] O Manager encerrou com codigo %CORVO_EXIT%.
pause
exit /b %CORVO_EXIT%
