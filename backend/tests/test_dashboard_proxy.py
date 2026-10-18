"""The local dashboard must renew its read-only identity without a browser login."""

import base64
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace


def test_dashboard_token_is_cached_and_renewed_before_expiry(monkeypatch):
    path = Path(__file__).resolve().parents[2] / "scripts/dashboard-local-proxy.py"
    spec = importlib.util.spec_from_file_location("dashboard_local_proxy", path)
    proxy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(proxy)
    clock = [1000]
    calls = []

    def issue(args, **kwargs):
        calls.append(args)
        assert args[-5:] == ["kubernetes-dashboard", "create", "token", "viewer", "--duration=1h"]
        assert kwargs["capture_output"] and kwargs["check"]
        payload = base64.urlsafe_b64encode(json.dumps({"exp": clock[0] + 3600}).encode()).decode().rstrip("=")
        return SimpleNamespace(stdout=f"header.{payload}.signature\n")

    monkeypatch.setattr(proxy.subprocess, "run", issue)
    monkeypatch.setattr(proxy.time, "time", lambda: clock[0])
    credentials = proxy.Credentials("local-cluster-config")
    original = credentials.get()
    clock[0] += 120
    assert credentials.get() == original
    assert len(calls) == 1
    clock[0] += 3000
    assert credentials.get() != original
    assert len(calls) == 2
