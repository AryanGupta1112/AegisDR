param([switch]$Update, [switch]$Stop)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$projectPath = (Get-Location).Path
$statePath = Join-Path $projectPath '.data/local-kubernetes'
$toolPath = Join-Path $projectPath '.data/tools'
New-Item -ItemType Directory -Force -Path $statePath, $toolPath | Out-Null
$configPath = Join-Path $statePath 'kubeconfig'
$processPath = Join-Path $statePath 'port-forward.pid'

function Stop-Forward {
    if (Test-Path -LiteralPath $processPath) {
        $forwardProcessId = [int](Get-Content -LiteralPath $processPath)
        $forwardProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$forwardProcessId" -ErrorAction SilentlyContinue
        if ($forwardProcess -and $forwardProcess.Name -eq 'kubectl.exe' -and
            $forwardProcess.CommandLine.Contains($configPath) -and $forwardProcess.CommandLine.Contains('port-forward')) {
            # Chocolatey's shim may launch a second kubectl process.
            Get-CimInstance Win32_Process -Filter "ParentProcessId=$forwardProcessId" |
                Where-Object { $_.Name -eq 'kubectl.exe' -and $_.CommandLine.Contains($configPath) -and
                    $_.CommandLine.Contains('port-forward') } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
            Stop-Process -Id $forwardProcessId -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $processPath
    }
}

if ($Stop) {
    Stop-Forward
    Write-Host 'Dashboard connection stopped. Kubernetes and saved data remain in Docker.'
    exit 0
}
foreach ($tool in @('docker', 'kubectl')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required" }
}
$pythonPath = Join-Path $projectPath '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { $pythonPath = (Get-Command python -ErrorAction Stop).Source }
& $pythonPath -c 'import yaml'
if ($LASTEXITCODE -ne 0) { throw 'Install PyYAML in your project Python environment first' }
docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop, then run this command again' }

$kindPath = Join-Path $toolPath 'kind.exe'
$checksumPath = Join-Path $toolPath 'kind.sha256sum'
$releaseUrl = 'https://github.com/kubernetes-sigs/kind/releases/download/v0.27.0'
if (-not (Test-Path -LiteralPath $checksumPath)) {
    Invoke-WebRequest -UseBasicParsing "$releaseUrl/kind-windows-amd64.sha256sum" -OutFile $checksumPath
}
if (-not (Test-Path -LiteralPath $kindPath)) {
    Write-Host 'Downloading the local Kubernetes tool (first run only)...'
    Invoke-WebRequest -UseBasicParsing "$releaseUrl/kind-windows-amd64" -OutFile $kindPath
}
$expectedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $kindPath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'kind checksum mismatch' }
$clusters = & $kindPath get clusters
if ($LASTEXITCODE -ne 0) { throw 'Could not list local clusters' }
if ($clusters -notcontains 'aegisdr-local') {
    Write-Host 'Creating the local cluster. The first download may take several minutes...'
    & $kindPath create cluster --name aegisdr-local --image kindest/node:v1.32.2 --kubeconfig $configPath --wait 180s
    if ($LASTEXITCODE -ne 0) { throw 'Local cluster creation failed' }
} else {
    $nodeRunning = docker inspect --format '{{.State.Running}}' aegisdr-local-control-plane
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the local Kubernetes node' }
    if ($nodeRunning -ne 'true') {
        docker start aegisdr-local-control-plane
        if ($LASTEXITCODE -ne 0) { throw 'Could not restart the local Kubernetes node' }
    }
    & $kindPath export kubeconfig --name aegisdr-local --kubeconfig $configPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not connect to the local cluster' }
}

$priorKubeconfig = $env:KUBECONFIG
try {
    $env:KUBECONFIG = $configPath
    $clusterReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        kubectl --request-timeout=5s get nodes -o name *> $null
        if ($LASTEXITCODE -eq 0) { $clusterReady = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $clusterReady) { throw 'The local Kubernetes API is not ready' }
    kubectl wait --for=condition=Ready nodes --all --timeout=180s
    if ($LASTEXITCODE -ne 0) { throw 'The local Kubernetes node is not ready' }
    $existing = kubectl -n aegisdr get deployment aegisdr --ignore-not-found -o name
    if ($LASTEXITCODE -ne 0) { throw 'Could not check the local deployment' }
    if ($Update -or -not $existing) {
        Stop-Forward
        $image = 'aegisdr-platform:local-' + (Get-Date -Format 'yyyyMMddHHmmss')
        docker build -f infrastructure/docker/Dockerfile -t $image .
        if ($LASTEXITCODE -ne 0) { throw 'Platform image build failed' }
        & $kindPath load docker-image $image --name aegisdr-local
        if ($LASTEXITCODE -ne 0) { throw 'Loading the platform image failed' }
        # Let Kubernetes pull the database image. Importing Docker Desktop's
        # multi-platform registry cache can reference layers absent on this PC.
        & $pythonPath scripts/prepare-kubernetes.py
        if ($LASTEXITCODE -ne 0) { throw 'Credential setup failed' }
        & $pythonPath scripts/deploy-kubernetes.py --image $image --host 127.0.0.1 --skip-ingress --local
        if ($LASTEXITCODE -ne 0) { throw 'Local deployment failed' }
    }
    if (Test-Path -LiteralPath $processPath) {
        $forwardProcessId = [int](Get-Content -LiteralPath $processPath)
        $forwardProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$forwardProcessId" -ErrorAction SilentlyContinue
        if ($forwardProcess -and $forwardProcess.Name -eq 'kubectl.exe' -and
            $forwardProcess.CommandLine.Contains($configPath) -and $forwardProcess.CommandLine.Contains('port-forward')) {
            try {
                $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8088/health' -TimeoutSec 5
                if ($health.status -eq 'ok') {
                    Write-Host 'AegisDR is ready: http://127.0.0.1:8088'
                    exit 0
                }
            } catch { }
        }
        Stop-Forward
    }
    if (Get-NetTCPConnection -State Listen -LocalPort 8088 -ErrorAction SilentlyContinue) {
        throw 'Port 8088 is in use. Stop the other AegisDR server before starting this connection.'
    }
    $kubectlPath = (Get-Command kubectl).Source
    $unshimmedKubectl = Join-Path (Split-Path -Parent (Split-Path -Parent $kubectlPath)) `
        'lib/kubernetes-cli/tools/kubernetes/client/bin/kubectl.exe'
    if (Test-Path -LiteralPath $unshimmedKubectl) { $kubectlPath = $unshimmedKubectl }
    $forwardProcess = Start-Process -FilePath $kubectlPath -ArgumentList @(
        '--kubeconfig', ('"' + $configPath + '"'), '--context', 'kind-aegisdr-local',
        '-n', 'aegisdr', 'port-forward', '--address', '127.0.0.1', 'service/aegisdr', '8088:8080'
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $statePath 'connection.log') `
      -RedirectStandardError (Join-Path $statePath 'connection-error.log')
    $forwardProcess.Id | Set-Content -LiteralPath $processPath
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($forwardProcess.HasExited) { throw 'Dashboard connection failed; see .data/local-kubernetes/connection-error.log' }
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8088/health' -TimeoutSec 2
            if ($health.status -eq 'ok') {
                Write-Host 'AegisDR is ready: http://127.0.0.1:8088'
                Write-Host 'Keep Docker Desktop running. Run this script again if the connection stops.'
                exit 0
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    throw 'Dashboard connection did not become ready'
} finally {
    $env:KUBECONFIG = $priorKubeconfig
}
