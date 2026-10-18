"""Offline structural checks complement kubeconform and Compose validation in CI."""

import json
from pathlib import Path

import yaml
from kubernetes_validate import validate

root = Path(__file__).resolve().parents[1]
resources = []
for path in (root / "infrastructure/kubernetes").rglob("*.yaml"):
    for obj in yaml.safe_load_all(path.read_text()):
        assert obj and obj.get("apiVersion") and obj.get("kind"), path
        if obj["kind"] == "Kustomization":
            for resource in obj["resources"]:
                assert (path.parent / resource).is_file()
            continue
        assert obj.get("metadata", {}).get("name"), path
        validate(obj, desired_version="1.31.0", strict=True)
        resources.append(obj)
assert len({(obj["kind"], obj["metadata"]["name"]) for obj in resources}) == len(resources)
for obj in resources:
    if obj["kind"] == "Deployment":
        assert obj["metadata"].get("namespace") in (None, "aegisdr-demo", "aegisdr", "aegisdr-dashboard")
        assert obj["spec"]["template"]["spec"]["containers"][0].get("readinessProbe")
for path in (root / ".github/workflows").glob("*.yml"):
    obj = yaml.safe_load(path.read_text())
    assert obj.get("jobs") and ("on" in obj or True in obj), path
json.loads((root / "infrastructure/monitoring/dashboards/aegisdr.json").read_text())
print(
    f"Validated {len(resources)} Kubernetes resources against strict 1.31 schemas, workflow structure and Grafana dashboard JSON"
)
