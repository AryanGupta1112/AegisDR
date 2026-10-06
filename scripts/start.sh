#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -r backend/requirements.txt
fi
(cd frontend && npm ci && npm run build)
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8088 --no-proxy-headers
