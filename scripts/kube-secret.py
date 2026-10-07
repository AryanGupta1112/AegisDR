"""Provision a generated password without putting it in argv, logs or tracked files."""

import base64
import json
import secrets
import subprocess

prefix = ["kubectl", "--context", "kind-aegisdr", "-n", "aegisdr-demo"]
existing = subprocess.run([*prefix, "get", "secret", "demo-database", "-o", "name"], capture_output=True, check=False)
if existing.returncode == 0:
    print("Existing demo secret preserved")
else:
    password = secrets.token_urlsafe(40)
    values = {"password": password, "url": f"postgresql://aegis:{password}@demo-postgres:5432/aegis_demo"}
    payload = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": "demo-database", "namespace": "aegisdr-demo"},
        "type": "Opaque",
        "data": {k: base64.b64encode(v.encode()).decode() for k, v in values.items()},
    }
    subprocess.run([*prefix, "apply", "-f", "-"], input=json.dumps(payload), text=True, check=True)
