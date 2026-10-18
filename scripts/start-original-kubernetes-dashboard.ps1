param([switch]$Stop)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$proxyPath = Join-Path (Get-Location).Path 'scripts/dashboard-local-proxy.py'
$proxyPidPath = Join-Path (Get-Location).Path '.data/local-kubernetes/original-dashboard-proxy.pid'
function Stop-LocalProxy {
    if (Test-Path -LiteralPath $proxyPidPath) {
        $proxyProcessId = [int](Get-Content -LiteralPath $proxyPidPath)
        $proxyProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$proxyProcessId" -ErrorAction SilentlyContinue
        if ($proxyProcess -and $proxyProcess.Name -eq 'python.exe' -and $proxyProcess.CommandLine.Contains($proxyPath)) {
            Get-CimInstance Win32_Process -Filter "ParentProcessId=$proxyProcessId" |
                Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine.Contains($proxyPath) } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
            Stop-Process -Id $proxyProcessId -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $proxyPidPath
    }
}
if ($Stop) {
    Stop-LocalProxy
    & "$PSScriptRoot/start-kubernetes-dashboard.ps1" -Original -Stop
    exit $LASTEXITCODE
}
$projectPath = (Get-Location).Path
$configPath = Join-Path $projectPath '.data/local-kubernetes/kubeconfig'
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Run .\scripts\start-kubernetes.ps1 first' }
$toolPath = Join-Path $projectPath '.data/tools'
New-Item -ItemType Directory -Force -Path $toolPath | Out-Null
$archivePath = Join-Path $toolPath 'helm.zip'
$checksumPath = Join-Path $toolPath 'helm.sha256sum'
$helmPath = Join-Path $toolPath 'helm/windows-amd64/helm.exe'
if (-not (Test-Path -LiteralPath $checksumPath)) {
    Invoke-WebRequest -UseBasicParsing https://get.helm.sh/helm-v3.17.3-windows-amd64.zip.sha256sum -OutFile $checksumPath
}
if (-not (Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest -UseBasicParsing https://get.helm.sh/helm-v3.17.3-windows-amd64.zip -OutFile $archivePath
}
$expectedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Helm checksum mismatch' }
if (-not (Test-Path -LiteralPath $helmPath)) {
    Expand-Archive -LiteralPath $archivePath -DestinationPath (Join-Path $toolPath 'helm')
}
& $helmPath upgrade --install kubernetes-dashboard kubernetes-dashboard `
    --repo https://kubernetes-retired.github.io/dashboard --version 7.14.0 `
    --kubeconfig $configPath --kube-context kind-aegisdr-local `
    --namespace kubernetes-dashboard --create-namespace --wait --timeout 10m | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Original Kubernetes Dashboard installation failed' }
kubectl --kubeconfig $configPath --context kind-aegisdr-local apply -f infrastructure/kubernetes/dashboard/original-viewer.yaml
if ($LASTEXITCODE -ne 0) { throw 'Dashboard viewer setup failed' }
& "$PSScriptRoot/start-kubernetes-dashboard.ps1" -Original -NoTokenClipboard
if ($LASTEXITCODE -ne 0) { throw 'Dashboard connection failed' }
Stop-LocalProxy
if (Get-NetTCPConnection -State Listen -LocalPort 9092 -ErrorAction SilentlyContinue) { throw 'Port 9092 is already in use' }
$pythonPath = Join-Path $projectPath '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { $pythonPath = (Get-Command python -ErrorAction Stop).Source }
$statePath = Join-Path $projectPath '.data/local-kubernetes'
$proxyProcess = Start-Process -FilePath $pythonPath -ArgumentList @(
    ('"' + $proxyPath + '"'), '--kubeconfig', ('"' + $configPath + '"')
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $statePath 'original-dashboard-proxy.log') `
  -RedirectStandardError (Join-Path $statePath 'original-dashboard-proxy-error.log')
$proxyProcess.Id | Set-Content -LiteralPath $proxyPidPath
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($proxyProcess.HasExited) { throw 'Automatic dashboard login failed; check .data/local-kubernetes/original-dashboard-proxy-error.log' }
    try {
        $response = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9092 -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host 'Open http://127.0.0.1:9092/#/workloads?namespace=aegisdr -- automatic read-only sign-in is enabled.'
            exit 0
        }
    } catch { }
    Start-Sleep -Seconds 1
}
throw 'Automatic dashboard login did not become ready'
