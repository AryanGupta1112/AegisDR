import json
import shutil
import subprocess
import time


class Cluster:
    def __init__(self, config):
        self.config = config

    def run(self, args, payload=None):
        if not self.config.kube_enabled:
            raise RuntimeError("Kubernetes is disabled. Set AEGIS_KUBE_ENABLED=true with an isolated demo context.")
        if not shutil.which("kubectl"):
            raise RuntimeError("kubectl is not installed")
        proc = subprocess.run(
            ["kubectl", "--request-timeout=10s", "-n", self.config.kube_namespace, *args],
            input=json.dumps(payload) if payload else None,
            capture_output=True,
            text=True,
            timeout=self.config.operation_timeout,
        )
        if proc.returncode:
            raise RuntimeError("Kubernetes command failed; check context, connectivity and namespace permissions")
        return json.loads(proc.stdout) if proc.stdout.strip().startswith(("{", "[")) else proc.stdout

    def inventory(self):
        if not self.config.kube_enabled:
            return {
                "connected": False,
                "namespace": self.config.kube_namespace,
                "reason": "Integration disabled; no cluster health has been measured",
                "items": [],
            }
        try:
            data = self.run(["get", "deployments,pods,services,configmaps", "-o", "json"])
            items = []
            for obj in data["items"]:
                items.append(
                    {
                        "kind": obj["kind"],
                        "name": obj["metadata"]["name"],
                        "namespace": obj["metadata"]["namespace"],
                        "status": obj.get("status", {}),
                        "managed": obj["metadata"].get("labels", {}).get("aegisdr.io/managed") == "true",
                    }
                )
            return {"connected": True, "namespace": self.config.kube_namespace, "reason": None, "items": items}
        except Exception as exc:
            return {"connected": False, "namespace": self.config.kube_namespace, "reason": str(exc), "items": []}

    def snapshot(self):
        data = self.run(["get", "deployments,services,configmaps", "-l", "aegisdr.io/managed=true", "-o", "json"])
        cleaned = []
        for obj in data["items"]:
            obj.pop("status", None)
            obj["metadata"] = {
                k: v for k, v in obj["metadata"].items() if k in ("name", "namespace", "labels", "annotations")
            }
            obj["metadata"].get("annotations", {}).pop("kubectl.kubernetes.io/last-applied-configuration", None)
            if obj["kind"] == "Service":
                for k in ("clusterIP", "clusterIPs", "ipFamilies", "ipFamilyPolicy", "healthCheckNodePort"):
                    obj["spec"].pop(k, None)
            cleaned.append(obj)
        return {"apiVersion": "v1", "kind": "List", "items": cleaned}

    def apply(self, payload):
        for item in payload["items"]:
            if (
                item["kind"] not in ("Deployment", "Service", "ConfigMap")
                or item["metadata"]["namespace"] != self.config.kube_namespace
                or item["metadata"].get("labels", {}).get("aegisdr.io/managed") != "true"
            ):
                raise ValueError("Only managed demo resources may be restored")
        return self.run(["apply", "-f", "-"], payload)

    def deployment(self):
        obj = self.run(["get", "deployment", self.config.kube_deployment, "-o", "json"])
        if obj["metadata"].get("labels", {}).get("aegisdr.io/managed") != "true":
            raise ValueError("Workload is not labeled aegisdr.io/managed=true")
        return obj

    def scale(self, replicas):
        self.deployment()
        self.run(["scale", "deployment", self.config.kube_deployment, f"--replicas={replicas}"])

    def wait_ready(self):
        self.run(
            [
                "rollout",
                "status",
                f"deployment/{self.config.kube_deployment}",
                f"--timeout={self.config.operation_timeout - 5}s",
            ]
        )
        obj = self.deployment()
        if obj.get("status", {}).get("availableReplicas", 0) < 1:
            raise RuntimeError("Demo workload has no available replicas")

    def simulate(self, scenario, stage):
        obj = self.deployment()
        replicas = obj["spec"].get("replicas", 1)
        if replicas < 1:
            raise ValueError("Demo deployment must be running before a simulation")
        if scenario == "pod-failure":
            pods = self.run(["get", "pods", "-l", "app=demo-app,aegisdr.io/managed=true", "-o", "json"])["items"]
            if not pods:
                raise ValueError("No isolated demo pod found")
            old_uid = pods[0]["metadata"]["uid"]
            stage("Terminating isolated demo pod", 35)
            self.run(["delete", "pod", pods[0]["metadata"]["name"], "--wait=true"])
            stage("Observing Kubernetes self-healing", 65)
            deadline = time.monotonic() + self.config.operation_timeout
            while time.monotonic() < deadline:
                fresh = self.run(["get", "pods", "-l", "app=demo-app,aegisdr.io/managed=true", "-o", "json"])["items"]
                if any(
                    p["metadata"]["uid"] != old_uid
                    and any(
                        c.get("type") == "Ready" and c.get("status") == "True"
                        for c in p.get("status", {}).get("conditions", [])
                    )
                    for p in fresh
                ):
                    return {"mechanism": "Kubernetes self-healing", "deleted_uid": old_uid}
                time.sleep(1)
            raise TimeoutError("Replacement pod readiness timed out")
        try:
            stage("Scaling isolated demo workload to zero", 35)
            self.scale(0)
            stopped = self.deployment()
            if stopped["spec"]["replicas"] != 0:
                raise RuntimeError("Scale-down was not observed")
            stage("Failure detected; restoring replica target", 65)
        finally:
            self.scale(replicas)
        self.wait_ready()
        return {"mechanism": "Configured replica recovery", "restored_replicas": replicas}
