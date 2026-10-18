param([switch]$Stop)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if ($Stop) {
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
    --namespace kubernetes-dashboard --create-namespace --wait --timeout 10m
if ($LASTEXITCODE -ne 0) { throw 'Original Kubernetes Dashboard installation failed' }
kubectl --kubeconfig $configPath --context kind-aegisdr-local apply -f infrastructure/kubernetes/dashboard/original-viewer.yaml
if ($LASTEXITCODE -ne 0) { throw 'Dashboard viewer setup failed' }
& "$PSScriptRoot/start-kubernetes-dashboard.ps1" -Original
