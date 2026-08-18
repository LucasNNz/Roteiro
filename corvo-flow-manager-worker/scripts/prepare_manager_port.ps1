param(
  [int]$Port = 32145,
  [string]$TargetVersion = '4.2.7'
)

$ErrorActionPreference = 'Stop'
$healthUrl = "http://127.0.0.1:$Port/health"

function Get-ListenerPid {
  param([int]$Port)
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($c) { return [int]$c.OwningProcess }
  } catch {}

  try {
    $line = netstat -ano -p tcp | Select-String -Pattern (":$Port\s+.*LISTENING\s+(\d+)\s*$") | Select-Object -First 1
    if ($line -and $line.Matches.Count -gt 0) { return [int]$line.Matches[0].Groups[1].Value }
  } catch {}
  return $null
}

function Test-PortFree {
  param([int]$Port)
  return -not (Get-ListenerPid -Port $Port)
}

$health = $null
try {
  $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
} catch {}

if ($health -and $health.ok) {
  $runningVersion = [string]$health.version
  if ($runningVersion -eq $TargetVersion) {
    Write-Host "[OK] CORVO FLOW MANAGER V$runningVersion ja esta em execucao." -ForegroundColor Green
    Write-Host "[OK] Reutilizando a instancia existente; nao sera iniciado um segundo servidor." -ForegroundColor Green
    try { Start-Process "http://127.0.0.1:$Port" | Out-Null } catch {}
    exit 20
  }

  $oldManagerProcessId = Get-ListenerPid -Port $Port
  if ($oldManagerProcessId) {
    $procName = ''
    try { $procName = (Get-Process -Id $oldManagerProcessId -ErrorAction Stop).ProcessName } catch {}
    Write-Host "[INFO] Encontrado CORVO FLOW MANAGER antigo V$runningVersion na porta $Port (PID $oldManagerProcessId $procName)." -ForegroundColor Yellow
    Write-Host "[INFO] Encerrando automaticamente a instancia antiga para iniciar V$TargetVersion..." -ForegroundColor Yellow
    try {
      Stop-Process -Id $oldManagerProcessId -Force -ErrorAction Stop
    } catch {
      Write-Host "[ERRO] Nao foi possivel encerrar o Manager antigo: $($_.Exception.Message)" -ForegroundColor Red
      exit 2
    }
    for ($i=0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 200
      if (Test-PortFree -Port $Port) {
        Write-Host "[OK] Porta $Port liberada." -ForegroundColor Green
        exit 0
      }
    }
    Write-Host "[ERRO] A porta $Port continuou ocupada apos encerrar o Manager antigo." -ForegroundColor Red
    exit 3
  }
}

$listenerPid = Get-ListenerPid -Port $Port
if ($listenerPid) {
  $procName = 'desconhecido'
  try { $procName = (Get-Process -Id $listenerPid -ErrorAction Stop).ProcessName } catch {}
  Write-Host "[ERRO] A porta $Port esta ocupada pelo processo PID $listenerPid ($procName), mas ele nao respondeu como CORVO FLOW MANAGER." -ForegroundColor Red
  Write-Host "[ERRO] Por seguranca, o inicializador NAO encerrou esse processo automaticamente." -ForegroundColor Red
  Write-Host "Feche o programa que usa essa porta e execute START_MANAGER.bat novamente." -ForegroundColor Yellow
  exit 4
}

Write-Host "[OK] Porta $Port livre para o CORVO FLOW MANAGER." -ForegroundColor Green
exit 0
