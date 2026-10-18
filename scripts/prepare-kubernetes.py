"""Create an isolated namespace and generate credentials once, without logging them."""

import json
import secrets
import subprocess


def run(*args, payload=None):
    return subprocess.run(["kubectl", *args], input=payload, text=True, capture_output=True, check=True).stdout


def main():
    run("cluster-info")
    namespace = {"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": "aegisdr"}}
    run("apply", "-f", "-", payload=json.dumps(namespace))
    existing = run("-n", "aegisdr", "get", "secret", "aegisdr-credentials", "--ignore-not-found", "-o", "name")
    if existing.strip():
        print("Existing Kubernetes credentials preserved")
        return
    password = secrets.token_urlsafe(40)
    secret = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": "aegisdr-credentials", "namespace": "aegisdr"},
        "type": "Opaque",
        "stringData": {
            "api-token": secrets.token_urlsafe(48),
            "postgres-password": password,
            "database-url": f"postgresql://aegis:{password}@aegisdr-postgres:5432/aegis_demo",
        },
    }
    # create, rather than apply, avoids retaining plaintext in a last-applied annotation.
    run("create", "-f", "-", payload=json.dumps(secret))
    print("Kubernetes credentials generated; values were not logged")


if __name__ == "__main__":
    main()
