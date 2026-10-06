$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed' }
    & ./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }
}
if (-not (Test-Path -LiteralPath 'frontend/node_modules')) {
    Push-Location frontend
    npm.cmd ci
    Pop-Location
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' }
}
Push-Location frontend
npm.cmd run build
Pop-Location
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
Write-Host 'AegisDR dashboard: http://127.0.0.1:8088 (Ctrl+C to stop)'
& ./.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8088 --no-proxy-headers
