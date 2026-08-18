param(
  [Parameter(Mandatory=$true)][string]$SourceDir,
  [Parameter(Mandatory=$true)][string]$DestinationDir
)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null

# Copy the engine to a stable per-user folder. Persistent Chrome profiles are NOT here;
# they remain under %LOCALAPPDATA%\CorvoFlowManager and therefore survive upgrades.
$robocopy = Join-Path $env:SystemRoot 'System32\robocopy.exe'
& $robocopy $SourceDir $DestinationDir /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD '.runtime' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "ROBOCOPY_FAILED_$LASTEXITCODE" }

$classes = 'HKCU:\Software\Classes\corvoflow'
New-Item -Path $classes -Force | Out-Null
Set-Item -Path $classes -Value 'URL:Corvo Flow Agent'
New-ItemProperty -Path $classes -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

$iconPath = Join-Path $classes 'DefaultIcon'
New-Item -Path $iconPath -Force | Out-Null
Set-Item -Path $iconPath -Value (Join-Path $env:SystemRoot 'System32\wscript.exe')

$commandPath = Join-Path $classes 'shell\open\command'
New-Item -Path $commandPath -Force | Out-Null
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$vbs = Join-Path $DestinationDir 'CORVO_FLOW_AGENT.vbs'
$protocolCommand = '"' + $wscript + '" "' + $vbs + '" "%1"'
Set-Item -Path $commandPath -Value $protocolCommand

$runPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runCommand = '"' + $wscript + '" "' + $vbs + '"'
New-ItemProperty -Path $runPath -Name 'CorvoFlowAgent' -Value $runCommand -PropertyType String -Force | Out-Null

Start-Process -FilePath $wscript -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
Write-Output 'CORVO_FLOW_AGENT_INSTALLED'
