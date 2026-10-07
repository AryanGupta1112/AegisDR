$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
foreach ($tool in @('docker', 'kubectl', 'kind', 'python')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required for optional local Kubernetes setup" }
}
docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon must be running' }
$clusters = kind get clusters
if ($clusters -notcontains 'aegisdr') {
    kind create cluster --name aegisdr --wait 120s
    if ($LASTEXITCODE -ne 0) { throw 'kind cluster creation failed' }
}
# Every command pins the dedicated context; never changes the current kube context.
docker build -f demo-app/Dockerfile -t aegisdr-demo:local .
if ($LASTEXITCODE -ne 0) { throw 'Demo image build failed' }
kind load docker-image aegisdr-demo:local --name aegisdr
kubectl --context kind-aegisdr apply -f infrastructure/kubernetes/namespace.yaml
if ($LASTEXITCODE -ne 0) { throw 'Namespace setup failed' }
python scripts/kube-secret.py
if ($LASTEXITCODE -ne 0) { throw 'Demo secret creation failed' }
kubectl --context kind-aegisdr apply -k infrastructure/kubernetes
if ($LASTEXITCODE -ne 0) { throw 'Manifest application failed' }
kubectl --context kind-aegisdr -n aegisdr-demo rollout status deployment/demo-app --timeout=120s
if ($LASTEXITCODE -ne 0) { throw 'Demo deployment did not become ready' }
python scripts/operator-config.py
if ($LASTEXITCODE -ne 0) { throw 'Scoped kubeconfig generation failed' }
Write-Host 'Isolated demo ready. Set KUBECONFIG to .data/operator-kubeconfig.json and AEGIS_KUBE_ENABLED=true before starting the backend.'
