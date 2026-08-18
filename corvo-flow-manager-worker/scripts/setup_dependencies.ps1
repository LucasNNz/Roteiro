$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root '.runtime'
$DownloadsDir = Join-Path $RuntimeDir 'downloads'
$EnvFile = Join-Path $RuntimeDir 'runtime.env.cmd'
$MinNodeMajor = 18

$PersistentRoot = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'CorvoFlowManager' } else { Join-Path $HOME 'CorvoFlowManager' }
$BrowserRuntimeRoot = Join-Path $PersistentRoot 'runtime\chrome-for-testing'
$BrowserCurrentFile = Join-Path $BrowserRuntimeRoot 'current.json'

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $DownloadsDir | Out-Null
New-Item -ItemType Directory -Force -Path $BrowserRuntimeRoot | Out-Null

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
} catch {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

function Write-Step([string]$Message) { Write-Host ("[CORVO] " + $Message) -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host ("[OK]    " + $Message) -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host ("[AVISO] " + $Message) -ForegroundColor Yellow }

function Get-NodeCandidate {
    $candidates = New-Object System.Collections.Generic.List[string]
    try { $cmd = Get-Command node.exe -ErrorAction Stop; if ($cmd.Source) { $candidates.Add($cmd.Source) } } catch {}
    if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles 'nodejs\node.exe')) }
    if (${env:ProgramFiles(x86)}) { $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')) }
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')) }
    Get-ChildItem -Path $RuntimeDir -Directory -Filter 'node-v*-win-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object { $candidates.Add((Join-Path $_.FullName 'node.exe')) }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not $candidate -or -not (Test-Path $candidate)) { continue }
        try {
            $versionText = (& $candidate --version 2>$null).Trim()
            if ($versionText -match '^v(\d+)\.') { return [PSCustomObject]@{ Path = $candidate; Major = [int]$Matches[1]; Version = $versionText } }
        } catch {}
    }
    return $null
}

function Get-NodeArchitecture {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    switch ($arch) { 'arm64' { return 'arm64' } 'x86' { return 'x86' } default { return 'x64' } }
}

function Install-PortableNode {
    Write-Step 'Node.js 18+ nao encontrado. Buscando a versao LTS oficial...'
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $release = $index | Where-Object { $_.lts -and $_.lts -ne $false } | Select-Object -First 1
    if (-not $release -or -not $release.version) { throw 'Nao foi possivel determinar a versao LTS do Node.js.' }
    $arch = Get-NodeArchitecture
    $version = [string]$release.version
    $fileName = "node-$version-win-$arch.zip"
    $url = "https://nodejs.org/dist/$version/$fileName"
    $zipPath = Join-Path $DownloadsDir $fileName
    $targetDir = Join-Path $RuntimeDir ("node-$version-win-$arch")
    if (-not (Test-Path (Join-Path $targetDir 'node.exe'))) {
        Write-Step "Baixando Node.js LTS $version ($arch) diretamente do nodejs.org..."
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
        if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
        Expand-Archive -Path $zipPath -DestinationPath $RuntimeDir -Force
        Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    }
    $nodeExe = Join-Path $targetDir 'node.exe'
    if (-not (Test-Path $nodeExe)) { throw "Node.js foi baixado, mas node.exe nao foi encontrado em $targetDir" }
    Write-Ok "Node.js portatil pronto: $((& $nodeExe --version).Trim())"
    return $nodeExe
}

function Get-ChromeForTestingStable {
    Write-Step 'Verificando Chrome for Testing (runtime do Worker)...'
    $endpoint = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'
    $data = Invoke-RestMethod -Uri $endpoint -UseBasicParsing
    $stable = $data.channels.Stable
    if (-not $stable -or -not $stable.version) { throw 'Nao foi possivel obter a versao Stable do Chrome for Testing.' }
    $download = $stable.downloads.chrome | Where-Object { $_.platform -eq 'win64' } | Select-Object -First 1
    if (-not $download -or -not $download.url) { throw 'Download win64 do Chrome for Testing nao encontrado.' }
    return [PSCustomObject]@{ Version = [string]$stable.version; Url = [string]$download.url }
}

function Ensure-ChromeForTesting {
    $stable = Get-ChromeForTestingStable
    $versionDir = Join-Path $BrowserRuntimeRoot $stable.Version
    $chromeExe = Join-Path $versionDir 'chrome-win64\chrome.exe'
    if (-not (Test-Path $chromeExe)) {
        $zipPath = Join-Path $DownloadsDir ("chrome-for-testing-$($stable.Version)-win64.zip")
        Write-Step "Baixando Chrome for Testing Stable $($stable.Version) para o Worker..."
        Invoke-WebRequest -Uri $stable.Url -OutFile $zipPath -UseBasicParsing
        if (Test-Path $versionDir) { Remove-Item -Recurse -Force $versionDir }
        New-Item -ItemType Directory -Force -Path $versionDir | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $versionDir -Force
        Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $chromeExe)) { throw "Chrome for Testing foi baixado, mas chrome.exe nao foi encontrado em $chromeExe" }
    [PSCustomObject]@{ version = $stable.Version; path = $chromeExe; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $BrowserCurrentFile -Encoding UTF8
    Write-Ok "Chrome for Testing pronto: $($stable.Version)"
    return $chromeExe
}

try {
    Write-Step 'Verificando Node.js...'
    $node = Get-NodeCandidate
    if (-not $node -or $node.Major -lt $MinNodeMajor) {
        if ($node) { Write-Warn "Node.js $($node.Version) e antigo demais; minimo exigido: v$MinNodeMajor." }
        $nodePath = Install-PortableNode
        $vText = (& $nodePath --version).Trim()
        if ($vText -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt $MinNodeMajor) { throw 'Node.js 18+ nao ficou disponivel apos o download automatico.' }
        $node = [PSCustomObject]@{ Path = $nodePath; Major = [int]$Matches[1]; Version = $vText }
    }
    Write-Ok "Node.js: $($node.Version)"

    # IMPORTANTE: Chrome 137+ bloqueia --load-extension no Google Chrome oficial.
    # O Manager usa Chrome for Testing, mantido pelo Google para automacao/testes,
    # para que cada perfil possa carregar automaticamente o Worker unpacked.
    $workerChrome = Ensure-ChromeForTesting

    Write-Step 'Verificando arquivos do Corvo Flow Manager...'
    $server = Join-Path $Root 'manager\server.js'
    $extension = Join-Path $Root 'extension\manifest.json'
    $bootstrap = Join-Path $Root 'extension\bootstrap.js'
    if (-not (Test-Path $server)) { throw 'manager\server.js nao encontrado. Extraia o ZIP completo.' }
    if (-not (Test-Path $extension)) { throw 'extension\manifest.json nao encontrado. Extraia o ZIP completo.' }
    if (-not (Test-Path $bootstrap)) { throw 'extension\bootstrap.js nao encontrado. Extraia o ZIP completo.' }
    Write-Ok 'Arquivos principais encontrados.'

    $nodeEscaped = $node.Path.Replace('%','%%')
    $chromeEscaped = $workerChrome.Replace('%','%%')
    @(
        '@echo off',
        ('set "CORVO_NODE_EXE=' + $nodeEscaped + '"'),
        ('set "CORVO_CHROME_EXE=' + $chromeEscaped + '"'),
        'set "CORVO_BROWSER_RUNTIME=CFT"'
    ) | Set-Content -Path $EnvFile -Encoding ASCII

    Write-Ok 'Dependencias prontas. Worker configurado para Chrome for Testing.'
    exit 0
} catch {
    Write-Host ''
    Write-Host ("[ERRO] " + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Verifique sua conexao com a Internet e execute START_MANAGER.bat novamente.' -ForegroundColor Yellow
    exit 1
}
