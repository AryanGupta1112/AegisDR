"""Generate local Compose secrets on first run; values are never printed."""
import os
import secrets
from pathlib import Path

root = Path("/secrets")
root.mkdir(exist_ok=True)
for name in ("postgres-password", "api-token", "grafana-password"):
    path = root / name
    if not path.exists():
        path.write_text(secrets.token_urlsafe(40))
        path.chmod(0o644)  # Named volume is mounted only into explicitly authorized services.
password = (root / "postgres-password").read_text().strip()
(root / "postgres-url").write_text(f"postgresql://aegis:{password}@postgres:5432/aegis_demo")
Path("/data").mkdir(exist_ok=True)
os.chown("/data", 10001, 10001)
print("Local secrets initialized; existing passwords preserved.")
