$ErrorActionPreference = 'SilentlyContinue'
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'CorvoFlowAgent' -Force
Remove-Item -Path 'HKCU:\Software\Classes\corvoflow' -Recurse -Force
Write-Output 'CORVO_FLOW_AGENT_AUTOSTART_REMOVED'
