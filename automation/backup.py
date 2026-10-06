"""Optional CLI trigger. Scheduling is owned by the persistent backend, never CI."""

import argparse
import json
import os
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("app_id")
parser.add_argument("--url", default="http://127.0.0.1:8088")
args = parser.parse_args()
token = os.environ.get("AEGIS_API_TOKEN")
if not token:
    raise SystemExit("Set AEGIS_API_TOKEN for authenticated CLI access")
request = urllib.request.Request(
    f"{args.url}/api/backups",
    data=json.dumps({"app_id": args.app_id}).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(request, timeout=10) as response:
    result = json.load(response)
print(f"Backup queued: {result['id']}")
