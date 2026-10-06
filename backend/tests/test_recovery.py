import datetime as dt
import io
import os
import tarfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.config import Settings
from backend.main import create_app
from backend.models import Application, Backup, Job, now
from backend.services.engine import digest


@pytest.fixture
def system(tmp_path):
    config = Settings(data_dir=tmp_path, api_token="test-token", scheduler_interval=1000, postgres_env="")
    app = create_app(config)
    app.state.worker.seed()
    client = TestClient(app, headers={"Authorization": "Bearer test-token", "Origin": "http://localhost:5173"})
    yield client, app.state.worker, app.state.sessions
    client.close()


def execute(client, worker, path, data):
    response = client.post(path, json=data)
    assert response.status_code == 202, response.text
    worker.process_one()
    return next(j for j in client.get("/api/jobs").json() if j["id"] == response.json()["id"])


def backup(system):
    client, worker, _ = system
    job = execute(client, worker, "/api/backups", {"app_id": "demo"})
    assert job["status"] == "completed", job
    return job["backup_id"]


def test_real_backup_restore_and_persistence(system):
    client, worker, sessions = system
    before = client.get("/api/demo/notes").json()
    source = worker.source("demo")
    (source / "important.txt").write_text("original payload")
    identifier = backup(system)
    assert (worker.backup_dir(identifier) / "database.sqlite3").is_file()
    assert client.post("/api/demo/notes", json={"text": "created after snapshot"}).status_code == 201
    (source / "important.txt").write_text("lost data")
    (source / "new-file.txt").write_text("new file")
    job = execute(client, worker, "/api/recovery", {"backup_id": identifier, "confirmation": "RESTORE Atlas Notes"})
    assert job["status"] == "completed", job
    assert job["detail"]["safety_backup_id"]
    assert client.get("/api/demo/notes").json() == before
    assert (source / "important.txt").read_text() == "original payload"
    assert not (source / "new-file.txt").exists()
    with sessions() as db:
        assert db.get(Job, job["id"]).status == "completed"
        assert db.get(Backup, identifier).verified_at
    assert client.get("/api/metrics").json()["recoveries"] == 1


@pytest.mark.parametrize("scenario", ["data-loss", "corruption"])
def test_isolated_disaster_drills(system, scenario):
    client, worker, _ = system
    before = worker.notes()
    job = execute(client, worker, "/api/simulations", {"scenario": scenario, "confirmation": "DISRUPT DEMO"})
    assert job["status"] == "completed", job
    assert len(job["detail"]["timeline"]) >= 3
    assert worker.notes() == before
    worker.verify(job["backup_id"])
    assert job["duration_seconds"] > 0


def test_corruption_is_detected_and_restore_blocked(system):
    client, worker, _ = system
    identifier = backup(system)
    with open(worker.backup_dir(identifier) / "files.tar.gz", "ab") as stream:
        stream.write(b"corruption")
    job = execute(client, worker, f"/api/backups/{identifier}/verify", {})
    assert job["status"] == "failed"
    assert "Checksum mismatch" in job["error"]
    assert client.get(f"/api/backups/{identifier}").json()["status"] == "corrupted"
    assert (
        client.post("/api/recovery", json={"backup_id": identifier, "confirmation": "RESTORE Atlas Notes"}).status_code
        == 409
    )


def test_missing_payload_and_manifest_tamper(system):
    _, worker, _ = system
    identifier = backup(system)
    manifest = worker.backup_dir(identifier) / "manifest.json"
    original = manifest.read_text()
    manifest.write_text("{}")
    with pytest.raises(ValueError, match="manifest"):
        worker.verify(identifier)
    manifest.write_text(original)
    (worker.backup_dir(identifier) / "files.tar.gz").unlink()
    with pytest.raises(ValueError, match="missing"):
        worker.verify(identifier)


@pytest.mark.parametrize("source", ["../escape", "/tmp/escape", "demo/../..", ".", ""])
def test_source_traversal_blocked(system, source):
    client, _, _ = system
    assert client.post("/api/applications", json={"name": "Unsafe", "source": source}).status_code == 422


def test_no_credentials_leak(system):
    client, _, _ = system
    config = client.get("/api/settings").json()
    assert "api_token" not in config
    assert "test-token" not in str(config)


def test_auth_and_cross_origin_protection(system):
    client, _, _ = system
    assert client.get("/api/applications", headers={"Authorization": "invalid"}).status_code == 401
    assert (
        client.post("/api/backups", json={"app_id": "demo"}, headers={"Origin": "https://evil.example"}).status_code
        == 403
    )
    assert client.post("/api/session", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/session").status_code == 200


def test_restore_confirmation_and_missing_resources(system):
    client, _, _ = system
    identifier = backup(system)
    assert client.post("/api/recovery", json={"backup_id": identifier, "confirmation": "yes"}).status_code == 422
    assert client.get("/api/backups/missing").status_code == 404
    assert client.post("/api/backups", json={"app_id": "missing"}).status_code == 404
    assert client.get(f"/api/backups/{identifier}/scope").json()["confirmation"] == "RESTORE Atlas Notes"


def test_retention_preserves_newest_and_active(system):
    client, worker, sessions = system
    first = backup(system)
    second = backup(system)
    worker.enqueue("restore", "demo", first)
    with sessions() as db:
        app = db.get(Application, "demo")
        app.retention = 1
        db.commit()
    worker.retention(app)
    assert client.get(f"/api/backups/{first}").json()["status"] == "completed"
    with sessions() as db:
        job = db.scalar(select(Job).where(Job.status == "queued"))
        job.status = "cancelled"
        db.commit()
    worker.retention(app)
    assert client.get(f"/api/backups/{first}").json()["status"] == "expired"
    assert client.get(f"/api/backups/{second}").json()["status"] == "completed"


def test_scheduler_policy_persistence_and_cancel(system):
    client, worker, sessions = system
    policy = {
        "enabled": True,
        "interval_minutes": 1,
        "retention": 3,
        "rpo_minutes": 2,
        "rto_seconds": 30,
        "retry_limit": 3,
    }
    assert client.patch("/api/applications/demo/policy", json=policy).status_code == 200
    with sessions() as db:
        app = db.get(Application, "demo")
        app.last_scheduled = (dt.datetime.now(dt.UTC) - dt.timedelta(minutes=2)).isoformat()
        db.commit()
    worker.monitor_and_schedule()
    worker.monitor_and_schedule()
    pending = [j for j in client.get("/api/jobs").json() if j["status"] == "queued"]
    assert len(pending) == 1
    assert pending[0]["detail"]["trigger"] == "scheduler"
    assert client.post(f"/api/jobs/{pending[0]['id']}/cancel").status_code == 200
    assert client.get("/api/applications/demo").json()["retention"] == 3


def test_registration_overlap_and_non_destructive_removal(system):
    client, worker, _ = system
    response = client.post("/api/applications", json={"name": "File app", "source": "my-app"})
    assert response.status_code == 201
    identifier = response.json()["id"]
    (worker.source("my-app") / "persistent.txt").write_text("keep me")
    assert client.post("/api/applications", json={"name": "Overlap", "source": "my-app/sub"}).status_code == 409
    assert client.delete(f"/api/applications/{identifier}").status_code == 204
    assert (worker.source("my-app") / "persistent.txt").read_text() == "keep me"
    assert client.delete("/api/applications/demo").status_code == 409


def test_kubernetes_unavailable_is_honest(system):
    client, _, _ = system
    assert client.get("/api/clusters").json()["connected"] is False
    assert (
        client.post("/api/simulations", json={"scenario": "pod-failure", "confirmation": "DISRUPT DEMO"}).status_code
        == 409
    )
    assert client.get("/api/metrics").json()["success_rate"] is None


def test_unsafe_archive_extraction_blocked(system):
    _, worker, sessions = system
    identifier = backup(system)
    path = worker.backup_dir(identifier) / "files.tar.gz"
    with tarfile.open(path, "w:gz") as archive:
        info = tarfile.TarInfo("../../escape.txt")
        info.size = 4
        archive.addfile(info, io.BytesIO(b"evil"))
    with sessions() as db:
        point = db.get(Backup, identifier)
        manifest = {
            **point.manifest,
            "files": {
                **point.manifest["files"],
                "files.tar.gz": {"sha256": digest(path), "size_bytes": path.stat().st_size},
            },
        }
        point.manifest = manifest
        (worker.backup_dir(identifier) / "manifest.json").write_text(__import__("json").dumps(manifest))
        db.commit()
    with pytest.raises(ValueError, match="Unsafe archive"):
        worker.restore(identifier)


def test_failed_backup_records_outcome(system):
    client, worker, _ = system
    worker.source("demo").rename(worker.config.data_dir / "missing-demo")
    job = execute(client, worker, "/api/backups", {"app_id": "demo"})
    assert job["status"] == "failed"
    assert "does not exist" in job["error"]
    assert client.get("/api/backups").json()[0]["status"] == "failed"


@pytest.mark.skipif(
    not os.environ.get("AEGIS_TEST_POSTGRES_URL"), reason="Disposable PostgreSQL integration URL not configured"
)
def test_real_postgres_dump_restore(tmp_path, monkeypatch):
    import importlib.util
    from pathlib import Path

    monkeypatch.setenv("AEGIS_DB_INTEGRATION", os.environ["AEGIS_TEST_POSTGRES_URL"])
    app = create_app(Settings(data_dir=tmp_path, api_token="test-token", postgres_env="AEGIS_DB_INTEGRATION"))
    worker = app.state.worker
    worker.seed()
    original = worker.notes()
    identifier = worker.create_backup(worker.demo_app())
    worker.add_note("not in recovery point")
    assert len(worker.notes()) == len(original) + 1
    worker.restore(identifier)
    assert worker.notes() == original

    monkeypatch.setenv("DATABASE_URL", os.environ["AEGIS_TEST_POSTGRES_URL"])
    spec = importlib.util.spec_from_file_location(
        "atlas_demo", Path(__file__).resolve().parents[2] / "demo-app/main.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with TestClient(module.app) as demo:
        assert demo.get("/health").json()["status"] == "ok"
        assert demo.get("/notes").json()["notes"] == original
        assert "Atlas Notes" in demo.get("/").text
    assert (worker.backup_dir(identifier) / "database.dump").stat().st_size > 0
    job = worker.enqueue("simulation", "demo", detail={"scenario": "data-loss"})
    worker.process_one()
    with app.state.sessions() as db:
        assert db.get(Job, job["id"]).status == "completed"
    assert worker.notes() == original


def test_metrics_openapi_and_prometheus(system):
    client, _, _ = system
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/api/applications").headers["cache-control"] == "no-store"
    assert client.get("/openapi.json", headers={"Accept-Encoding": "gzip"}).headers["content-encoding"] == "gzip"
    assert "aegisdr_backups" in client.get("/metrics").text
    assert client.get("/openapi.json").json()["info"]["title"] == "AegisDR API"
    assert now().endswith("+00:00")


def test_duplicate_backup_requests_share_pending_job(system):
    client, _, _ = system
    first = client.post("/api/backups", json={"app_id": "demo"}).json()
    second = client.post("/api/backups", json={"app_id": "demo"}).json()
    assert first["id"] == second["id"]
    assert len(client.get("/api/jobs").json()) == 1


def test_persistent_jobs_survive_restart_and_interrupted_jobs_fail(system, monkeypatch):
    _, worker, sessions = system
    queued = worker.enqueue("backup", "demo")
    interrupted = worker.enqueue("simulation", "demo", detail={"scenario": "corruption"})
    with sessions() as db:
        db.get(Job, interrupted["id"]).status = "running"
        db.commit()
    new_app = create_app(worker.config)
    monkeypatch.setattr(new_app.state.worker, "process_one", lambda: None)
    monkeypatch.setattr(new_app.state.worker, "monitor_and_schedule", lambda: None)
    with TestClient(new_app) as restarted:
        assert restarted.get("/health").status_code == 200
        with new_app.state.sessions() as db:
            assert db.get(Job, queued["id"]).status == "queued"
            assert db.get(Job, interrupted["id"]).status == "failed"
            assert "interrupted" in db.get(Job, interrupted["id"]).error


def test_health_failures_do_not_restore_data(system):
    _, worker, sessions = system
    with sessions() as db:
        application = db.get(Application, "demo")
        application.source = "missing"
        db.commit()
    for _ in range(4):
        worker.monitor_and_schedule()
    with sessions() as db:
        assert db.get(Application, "demo").failures == 4
        assert not db.scalars(select(Job)).all()
