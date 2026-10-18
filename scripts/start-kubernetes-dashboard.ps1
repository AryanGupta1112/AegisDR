param([switch]$Stop, [switch]$Original, [switch]$NoTokenClipboard)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$statePath = Join-Path (Get-Location).Path '.data/local-kubernetes'
$configPath = Join-Path $statePath 'kubeconfig'
$processPath = Join-Path $statePath 'dashboard.pid'
$dashboardNamespace = 'aegisdr-dashboard'
$dashboardService = 'headlamp'
$dashboardPort = 9091
$dashboardUrl = 'http://127.0.0.1:9091'
if ($Original) {
    $processPath = Join-Path $statePath 'original-dashboard.pid'
    $dashboardNamespace = 'kubernetes-dashboard'
    $dashboardService = 'kubernetes-dashboard-kong-proxy'
    $dashboardPort = 8443
    $dashboardUrl = 'https://localhost:8443'
}
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Run .\scripts\start-kubernetes.ps1 first' }

function Stop-DashboardConnection {
    if (Test-Path -LiteralPath $processPath) {
        $dashboardProcessId = [int](Get-Content -LiteralPath $processPath)
        $dashboardProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$dashboardProcessId" -ErrorAction SilentlyContinue
        if ($dashboardProcess -and $dashboardProcess.Name -eq 'kubectl.exe' -and
            $dashboardProcess.CommandLine.Contains($configPath) -and
            $dashboardProcess.CommandLine.Contains("service/$dashboardService")) {
            Stop-Process -Id $dashboardProcessId -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $processPath
    }
}

if ($Stop) {
    Stop-DashboardConnection
    Write-Host 'Kubernetes dashboard connection stopped. Your cluster remains running.'
    exit 0
}
if (-not $Original) {
    kubectl --kubeconfig $configPath --context kind-aegisdr-local apply -f infrastructure/kubernetes/dashboard/headlamp.yaml
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard setup failed' }
    kubectl --kubeconfig $configPath --context kind-aegisdr-local -n aegisdr-dashboard `
        rollout status deployment/headlamp --timeout=300s
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard is not ready' }
}
Stop-DashboardConnection
if (Get-NetTCPConnection -State Listen -LocalPort $dashboardPort -ErrorAction SilentlyContinue) {
    throw "Port $dashboardPort is already in use"
}
$kubectlPath = (Get-Command kubectl).Source
$unshimmedKubectl = Join-Path (Split-Path -Parent (Split-Path -Parent $kubectlPath)) `
    'lib/kubernetes-cli/tools/kubernetes/client/bin/kubectl.exe'
if (Test-Path -LiteralPath $unshimmedKubectl) { $kubectlPath = $unshimmedKubectl }
$dashboardProcess = Start-Process -FilePath $kubectlPath -ArgumentList @(
    '--kubeconfig', ('"' + $configPath + '"'), '--context', 'kind-aegisdr-local',
    '-n', $dashboardNamespace, 'port-forward', '--address', '127.0.0.1', "service/$dashboardService",
    ("{0}:{1}" -f $dashboardPort, $(if ($Original) { 443 } else { 80 }))
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $statePath "dashboard-$dashboardPort.log") `
  -RedirectStandardError (Join-Path $statePath "dashboard-$dashboardPort-error.log")
$dashboardProcess.Id | Set-Content -LiteralPath $processPath
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($dashboardProcess.HasExited) { throw 'Dashboard connection failed; check .data/local-kubernetes/dashboard-error.log' }
    try {
        if ($Original) {
            # The archived chart's local Kong endpoint uses a self-signed certificate.
            $status = curl.exe --insecure --silent --max-time 2 --output NUL --write-out '%{http_code}' $dashboardUrl
            if ($status -eq '200') { $ready = $true; break }
        } else {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $dashboardUrl -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Dashboard did not respond' }
if ($NoTokenClipboard) {
    Write-Host 'Dashboard upstream connection is ready.'
    exit 0
}
$loginToken = kubectl --kubeconfig $configPath --context kind-aegisdr-local -n $dashboardNamespace `
    create token viewer --duration=24h
if ($LASTEXITCODE -ne 0) { throw 'Could not create the dashboard login' }
Set-Clipboard -Value $loginToken
Remove-Variable loginToken
Write-Host "Kubernetes dashboard: $dashboardUrl"
Write-Host 'A read-only login token is copied to your clipboard. Paste it into the dashboard and sign in.'
Write-Host 'The token expires in 24 hours. Run this script again for a new one.'
