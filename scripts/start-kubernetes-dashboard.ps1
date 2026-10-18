param([switch]$Stop)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$statePath = Join-Path (Get-Location).Path '.data/local-kubernetes'
$configPath = Join-Path $statePath 'kubeconfig'
$processPath = Join-Path $statePath 'dashboard.pid'
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Run .\scripts\start-kubernetes.ps1 first' }

function Stop-DashboardConnection {
    if (Test-Path -LiteralPath $processPath) {
        $dashboardProcessId = [int](Get-Content -LiteralPath $processPath)
        $dashboardProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$dashboardProcessId" -ErrorAction SilentlyContinue
        if ($dashboardProcess -and $dashboardProcess.Name -eq 'kubectl.exe' -and
            $dashboardProcess.CommandLine.Contains($configPath) -and
            $dashboardProcess.CommandLine.Contains('service/headlamp')) {
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
kubectl --kubeconfig $configPath --context kind-aegisdr-local apply -f infrastructure/kubernetes/dashboard/headlamp.yaml
if ($LASTEXITCODE -ne 0) { throw 'Dashboard setup failed' }
kubectl --kubeconfig $configPath --context kind-aegisdr-local -n aegisdr-dashboard `
    rollout status deployment/headlamp --timeout=300s
if ($LASTEXITCODE -ne 0) { throw 'Dashboard is not ready' }
Stop-DashboardConnection
if (Get-NetTCPConnection -State Listen -LocalPort 9091 -ErrorAction SilentlyContinue) {
    throw 'Port 9091 is already in use'
}
$kubectlPath = (Get-Command kubectl).Source
$unshimmedKubectl = Join-Path (Split-Path -Parent (Split-Path -Parent $kubectlPath)) `
    'lib/kubernetes-cli/tools/kubernetes/client/bin/kubectl.exe'
if (Test-Path -LiteralPath $unshimmedKubectl) { $kubectlPath = $unshimmedKubectl }
$dashboardProcess = Start-Process -FilePath $kubectlPath -ArgumentList @(
    '--kubeconfig', ('"' + $configPath + '"'), '--context', 'kind-aegisdr-local',
    '-n', 'aegisdr-dashboard', 'port-forward', '--address', '127.0.0.1', 'service/headlamp', '9091:80'
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $statePath 'dashboard.log') `
  -RedirectStandardError (Join-Path $statePath 'dashboard-error.log')
$dashboardProcess.Id | Set-Content -LiteralPath $processPath
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($dashboardProcess.HasExited) { throw 'Dashboard connection failed; check .data/local-kubernetes/dashboard-error.log' }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9091' -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Dashboard did not respond' }
$loginToken = kubectl --kubeconfig $configPath --context kind-aegisdr-local -n aegisdr-dashboard `
    create token viewer --duration=24h
if ($LASTEXITCODE -ne 0) { throw 'Could not create the dashboard login' }
Set-Clipboard -Value $loginToken
Remove-Variable loginToken
Write-Host 'Kubernetes dashboard: http://127.0.0.1:9091'
Write-Host 'A read-only login token is copied to your clipboard. Paste it into the dashboard and sign in.'
Write-Host 'The token expires in 24 hours. Run this script again for a new one.'
