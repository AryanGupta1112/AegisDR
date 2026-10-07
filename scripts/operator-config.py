"""Generate an ignored, namespace-scoped, 24-hour operator kubeconfig."""

import json
import os
import subprocess
from pathlib import Path

prefix = ["kubectl", "--context", "kind-aegisdr"]
config = json.loads(subprocess.check_output([*prefix, "config", "view", "--minify", "--raw", "-o", "json"], text=True))
token = subprocess.check_output(
    [*prefix, "-n", "aegisdr-demo", "create", "token", "aegisdr-operator", "--duration=24h"], text=True
).strip()
config["users"] = [{"name": "aegisdr-operator", "user": {"token": token}}]
config["contexts"][0]["context"]["user"] = "aegisdr-operator"
config["contexts"][0]["context"]["namespace"] = "aegisdr-demo"
path = Path(".data/operator-kubeconfig.json")
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(config))
if os.name != "nt":
    path.chmod(0o600)
print("Scoped operator configuration written under ignored .data; expires in 24 hours")
