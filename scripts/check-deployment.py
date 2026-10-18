"""Exercise a disposable Compose deployment without reading or printing secrets."""

import http.cookiejar
import json
import os
import time
import urllib.request

BASE = "http://127.0.0.1:8088"
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, data=None, base=BASE):
    payload = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        base + path,
        data=payload,
        headers={"Content-Type": "application/json", "Origin": BASE},
    )
    with opener.open(req, timeout=15) as response:
        return json.load(response)


def wait_for_job(job):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        current = next(row for row in request("/api/jobs") if row["id"] == job["id"])
        if current["status"] == "completed":
            return current
        if current["status"] in ("failed", "cancelled"):
            raise RuntimeError(f"{current['kind']} ended with status {current['status']}")
        time.sleep(1)
    raise TimeoutError(f"{job['kind']} did not complete within 120 seconds")


def main():
    assert request("/health")["status"] == "ok"
    with opener.open(BASE + "/applications", timeout=15) as response:
        assert b'<div id="root"' in response.read(), "Compiled dashboard is unavailable"
    request("/api/session", {})
    app = next(row for row in request("/api/applications") if row["demo"])
    assert app["kind"] == "postgres", "Expected the Compose PostgreSQL demo"
    request("/api/demo/notes", {"text": "Deployment recovery check"})
    original_notes = request("/api/demo/notes")["notes"]
    backup = wait_for_job(request("/api/backups", {"app_id": app["id"]}))
    wait_for_job(request(f"/api/backups/{backup['backup_id']}/verify", {}))
    wait_for_job(request("/api/simulations", {"scenario": "data-loss", "confirmation": "DISRUPT DEMO"}))
    assert request("/api/demo/notes")["notes"] == original_notes, "Recovery changed the original notes"
    assert request("/health", base="http://127.0.0.1:8001")["database"] == "postgresql"
    grafana_url = os.environ.get("AEGIS_CHECK_GRAFANA_URL", "http://127.0.0.1:3000")
    assert request("/api/health", base=grafana_url)["database"] == "ok"
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        targets = request("/api/v1/targets", base="http://127.0.0.1:9090")["data"]["activeTargets"]
        if any(target["labels"].get("job") == "aegisdr" and target["health"] == "up" for target in targets):
            break
        time.sleep(2)
    else:
        raise RuntimeError("Prometheus could not scrape the platform")
    print("Deployment passed: dashboard, PostgreSQL backup/verification/recovery, demo app, Grafana and Prometheus")


if __name__ == "__main__":
    main()
