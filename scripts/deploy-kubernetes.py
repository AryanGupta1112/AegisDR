"""Render a release, validate it on the server, and wait for its rollout."""

import argparse
import json
import re
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def run(*args, payload=None):
    return subprocess.run(["kubectl", *args], input=payload, text=True, capture_output=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--ingress-class", default="nginx")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--skip-ingress", action="store_true", help="For isolated cluster tests using port-forward")
    parser.add_argument("--local", action="store_true", help="Enable loopback-only browser login for a local cluster")
    args = parser.parse_args()
    if args.local and (not args.skip_ingress or args.host not in ("localhost", "127.0.0.1")):
        parser.error("--local requires --skip-ingress and a loopback hostname")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", args.host):
        parser.error("--host must be a DNS hostname without a scheme or path")
    if not re.fullmatch(r"[a-z0-9][a-z0-9./:@_-]*", args.image):
        parser.error("--image must be a container image reference")
    resources = list(yaml.safe_load_all(run("kustomize", str(ROOT / "infrastructure/kubernetes/cloud"))))
    for resource in resources:
        if resource["kind"] == "Deployment":
            container = resource["spec"]["template"]["spec"]["containers"][0]
            container["image"] = args.image
            for env in container["env"]:
                if env["name"] == "AEGIS_ORIGINS":
                    env["value"] = (
                        "http://127.0.0.1:8088,http://localhost:8088" if args.local else f"https://{args.host}"
                    )
                if env["name"] == "AEGIS_LOCAL_MODE" and args.local:
                    env["value"] = "true"
            if args.local:
                resource["spec"]["template"]["spec"].pop("imagePullSecrets", None)
        if resource["kind"] == "Ingress":
            resource["spec"]["ingressClassName"] = args.ingress_class
            resource["spec"]["rules"][0]["host"] = args.host
            resource["spec"]["tls"][0]["hosts"] = [args.host]
    if args.skip_ingress:
        resources = [resource for resource in resources if resource["kind"] != "Ingress"]
    payload = yaml.safe_dump_all(resources)
    if args.render_only:
        print(payload)
        return
    run("-n", "aegisdr", "get", "secret", "aegisdr-credentials")
    if not args.skip_ingress:
        run("-n", "aegisdr", "get", "secret", "aegisdr-tls")
    run("apply", "--dry-run=server", "-f", "-", payload=payload)
    database = [resource for resource in resources if resource["metadata"]["name"] == "aegisdr-postgres"]
    run("apply", "-f", "-", payload=yaml.safe_dump_all(database))
    run("-n", "aegisdr", "rollout", "status", "statefulset/aegisdr-postgres", "--timeout=300s")
    previous = run("-n", "aegisdr", "get", "deployment", "aegisdr", "--ignore-not-found", "-o", "json")
    run("apply", "-f", "-", payload=payload)
    try:
        run("-n", "aegisdr", "rollout", "status", "deployment/aegisdr", "--timeout=300s")
    except subprocess.CalledProcessError:
        if previous.strip() and json.loads(previous)["metadata"].get("uid"):
            run("-n", "aegisdr", "rollout", "undo", "deployment/aegisdr")
            run("-n", "aegisdr", "rollout", "status", "deployment/aegisdr", "--timeout=300s")
            print("Previous platform release restored; deployment failed")
        raise
    print("Kubernetes release is ready")


if __name__ == "__main__":
    main()
