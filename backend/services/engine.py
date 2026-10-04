import datetime as dt
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import threading
import time
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.parse import unquote, urlparse

from sqlalchemy import select

from backend.models import Application, Backup, Event, Job, now, serialize, uid
from backend.services.cluster import Cluster


def digest(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class RecoveryEngine:
    def __init__(self, config, sessions):
        self.config = config
        self.sessions = sessions
        self.cluster = Cluster(config)
        self.lock = threading.RLock()
        self.queue_lock = threading.Lock()

    def source(self, name, must_exist=True):
        root = (self.config.data_dir / "protected").resolve()
        candidate = root / name
        path = candidate.resolve()
        if not name or path == root or not path.is_relative_to(root):
            raise ValueError("Source must be a subdirectory of the protected root")
        if must_exist and not path.is_dir():
            raise ValueError("Protected source directory does not exist")
        # Junctions and symlinks must not escape the protected root.
        for parent in [candidate, *candidate.parents]:
            if parent == root:
                break
            if parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()):
                raise ValueError("Linked source directories are not permitted")
        return path

    def backup_dir(self, identifier):
        if not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise ValueError("Invalid recovery point identifier")
        root = (self.config.data_dir / "backups").resolve()
        path = (root / identifier).resolve()
        if not path.is_relative_to(root) or path == root:
            raise ValueError("Invalid backup path")
        return path

    def event(self, action, message, resource=None, level="info"):
        logging.getLogger("aegisdr").info(
            json.dumps({"at": now(), "action": action, "message": message, "resource_id": resource, "level": level})
        )
        with self.sessions() as db:
            db.add(Event(action=action, message=message, resource_id=resource, level=level))
            db.commit()

    def seed(self):
        with self.sessions() as db:
            if db.scalar(select(Application).where(Application.demo.is_(True))):
                return
            source = self.source("demo", False)
            source.mkdir(parents=True, exist_ok=True)
            (source / "welcome.txt").write_text(
                "AegisDR persistent demo files. Edit this file and restore a recovery point.\n"
            )
            kind = "postgres" if self.config.postgres_env else "sqlite"
            db.add(
                Application(
                    id="demo",
                    name="Atlas Notes",
                    description="Disposable demo dataset · safe recovery sandbox",
                    kind=kind,
                    source="demo",
                    demo=True,
                    db_env=self.config.postgres_env,
                )
            )
            db.commit()
        self.init_demo()
        self.event("system.initialized", f"Local metadata initialized; demo database engine: {kind}")

    def demo_app(self):
        with self.sessions() as db:
            return db.get(Application, "demo")

    @contextmanager
    def connect_demo(self):
        app = self.demo_app()
        if app.kind == "postgres":
            import psycopg

            connection = psycopg.connect(os.environ[app.db_env], connect_timeout=5)
        else:
            connection = sqlite3.connect(self.source(app.source) / "notes.sqlite3")
        try:
            yield connection
        finally:
            connection.close()

    def init_demo(self):
        with self.connect_demo() as db:
            db.execute("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, text TEXT NOT NULL)")
            if db.execute("SELECT COUNT(*) FROM notes").fetchone()[0] == 0:
                for text in (
                    "The first rule of recovery: verify the backup.",
                    "A real dataset. A measurable recovery.",
                    "Your next recovery drill starts here.",
                ):
                    placeholder = "%s" if self.demo_app().kind == "postgres" else "?"
                    db.execute(f"INSERT INTO notes (id, text) VALUES ({placeholder}, {placeholder})", (uid(), text))
            db.commit()

    def notes(self):
        with self.lock, self.connect_demo() as db:
            return [{"id": r[0], "text": r[1]} for r in db.execute("SELECT id, text FROM notes ORDER BY id").fetchall()]

    def add_note(self, text):
        with self.lock, self.connect_demo() as db:
            placeholder = "%s" if self.demo_app().kind == "postgres" else "?"
            db.execute(f"INSERT INTO notes (id,text) VALUES ({placeholder},{placeholder})", (uid(), text))
            db.commit()
        self.event("demo.note_added", "A note was added to the disposable dataset", "demo")

    def pg(self, app, tool, extra):
        url = urlparse(os.environ.get(app.db_env, ""))
        if url.scheme not in ("postgres", "postgresql") or not url.hostname or not url.path.strip("/"):
            raise ValueError("PostgreSQL environment reference is missing or invalid")
        env = dict(
            os.environ,
            PGHOST=url.hostname,
            PGPORT=str(url.port or 5432),
            PGUSER=unquote(url.username or "postgres"),
            PGPASSWORD=unquote(url.password or ""),
            PGDATABASE=url.path.lstrip("/"),
            PGCONNECT_TIMEOUT="5",
            PGOPTIONS=f"-c statement_timeout={self.config.operation_timeout * 1000}",
        )
        # Passwords and DSNs never enter command arguments or API errors.
        exe = shutil.which(tool)
        if not exe:
            raise RuntimeError(f"{tool} is unavailable; install PostgreSQL client tools")
        result = subprocess.run([exe, *extra], env=env, capture_output=True, timeout=self.config.operation_timeout)
        if result.returncode:
            raise RuntimeError(
                f"{tool} failed (exit {result.returncode}); verify database connectivity and client/server compatibility"
            )

    def create_backup(self, app, stage=lambda *_: None):
        started = time.monotonic()
        identifier = uid()
        directory = self.backup_dir(identifier)
        directory.mkdir()
        with self.sessions() as db:
            db.add(Backup(id=identifier, app_id=app.id, app_name=app.name, status="running"))
            db.commit()
        try:
            source = self.source(app.source)
            stage("Archiving persistent files", 20)
            with tarfile.open(directory / "files.tar.gz", "w:gz") as archive:
                for path in sorted(source.rglob("*")):
                    if (
                        path.is_symlink()
                        or (hasattr(path, "is_junction") and path.is_junction())
                        or not path.resolve().is_relative_to(source)
                    ):
                        raise ValueError("Linked files are not permitted in backups")
                    if time.monotonic() - started > self.config.operation_timeout:
                        raise TimeoutError("File backup deadline exceeded")
                    if path.is_file() and not (app.kind == "sqlite" and path.name.startswith("notes.sqlite3")):
                        archive.add(path, arcname=path.relative_to(source).as_posix(), recursive=False)
            stage("Snapshotting application database", 45)
            if app.kind == "postgres":
                self.pg(app, "pg_dump", ["--format=custom", "--no-owner", "--file", str(directory / "database.dump")])
            elif app.kind == "sqlite":
                with (
                    closing(sqlite3.connect(source / "notes.sqlite3")) as src,
                    closing(sqlite3.connect(directory / "database.sqlite3")) as dest,
                ):
                    src.backup(dest)
            if self.config.kube_enabled and app.demo:
                (directory / "kubernetes.json").write_text(json.dumps(self.cluster.snapshot()))
            manifest = {
                "version": 1,
                "id": identifier,
                "app_id": app.id,
                "kind": app.kind,
                "source": app.source,
                "created_at": now(),
                "files": {p.name: {"sha256": digest(p), "size_bytes": p.stat().st_size} for p in directory.iterdir()},
            }
            (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
            with self.sessions() as db:
                backup = db.get(Backup, identifier)
                backup.manifest = manifest
                backup.size_bytes = sum(p.stat().st_size for p in directory.iterdir())
                backup.status = "completed"
                backup.duration_seconds = time.monotonic() - started
                db.commit()
            stage("Verifying SHA-256 checksums", 75)
            self.verify(identifier)
            self.event("backup.completed", f"Recovery point created and verified for {app.name}", identifier)
            return identifier
        except Exception as exc:
            with self.sessions() as db:
                backup = db.get(Backup, identifier)
                backup.status = "failed"
                backup.error = str(exc)
                backup.duration_seconds = time.monotonic() - started
                db.commit()
            raise

    def verify(self, identifier, directory=None, record=True):
        with self.sessions() as db:
            backup = db.get(Backup, identifier)
            if not backup or backup.status not in ("completed", "corrupted"):
                raise ValueError("Recovery point is unavailable")
            root = directory or self.backup_dir(identifier)
            try:
                manifest = json.loads((root / "manifest.json").read_text())
                if manifest != backup.manifest or not manifest.get("files"):
                    raise ValueError("Backup manifest does not match persisted metadata")
                for name, expected in manifest["files"].items():
                    path = (root / name).resolve()
                    if path.parent != root.resolve() or path.is_symlink() or not path.is_file():
                        raise ValueError("Backup payload is missing or unsafe")
                    if path.stat().st_size != expected["size_bytes"] or digest(path) != expected["sha256"]:
                        raise ValueError(f"Checksum mismatch: {name}")
                if record:
                    backup.status = "completed"
                    backup.verified_at = now()
                    backup.error = None
                    db.commit()
                return manifest
            except Exception as exc:
                if record:
                    backup.status = "corrupted"
                    backup.error = str(exc)
                    db.commit()
                raise ValueError(f"Integrity verification failed: {exc}") from exc

    def restore(self, identifier, stage=lambda *_: None, kubernetes=False):
        manifest = self.verify(identifier)
        with self.sessions() as db:
            backup = db.get(Backup, identifier)
            app = db.get(Application, backup.app_id)
            if not app or app.kind != manifest["kind"] or app.source != manifest["source"]:
                raise ValueError("Application configuration changed; restore scope no longer matches")
        root = self.backup_dir(identifier)
        source = self.source(app.source)
        stage("Validating restore scope and archive paths", 20)
        with tempfile.TemporaryDirectory(dir=self.config.data_dir / "scratch") as temporary:
            target = Path(temporary) / "restore"
            target.mkdir()
            with tarfile.open(root / "files.tar.gz", "r:gz") as archive:
                for member in archive.getmembers():
                    path = (target / member.name).resolve()
                    if not path.is_relative_to(target) or not member.isfile():
                        raise ValueError("Unsafe archive entry; only regular files can be restored")
                archive.extractall(target, filter="data")
            stage("Restoring database transaction", 55)
            if app.kind == "postgres":
                self.pg(
                    app,
                    "pg_restore",
                    [
                        "--clean",
                        "--if-exists",
                        "--single-transaction",
                        "--no-owner",
                        "--dbname",
                        urlparse(os.environ[app.db_env]).path.lstrip("/"),
                        str(root / "database.dump"),
                    ],
                )
            elif app.kind == "sqlite":
                with (
                    closing(sqlite3.connect(root / "database.sqlite3")) as src,
                    closing(sqlite3.connect(target / "notes.sqlite3")) as dest,
                ):
                    if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise ValueError("SQLite backup integrity check failed")
                    src.backup(dest)
            stage("Replacing persistent files", 75)
            previous = Path(temporary) / "previous"
            source.rename(previous)
            try:
                shutil.move(str(target), str(source))
            except Exception:
                previous.rename(source)
                raise
        if kubernetes:
            if not (root / "kubernetes.json").exists():
                raise ValueError("This recovery point contains no Kubernetes snapshot")
            stage("Reapplying managed Kubernetes resources", 85)
            self.cluster.apply(json.loads((root / "kubernetes.json").read_text()))
            self.cluster.wait_ready()
        stage("Verifying restored files and database connectivity", 95)
        with tarfile.open(root / "files.tar.gz", "r:gz") as archive:
            for member in archive.getmembers():
                stream = archive.extractfile(member)
                if stream and hashlib.sha256(stream.read()).hexdigest() != digest(source / member.name):
                    raise ValueError("Restored file content verification failed")
        if app.demo:
            self.notes()
        self.event("recovery.completed", f"Restored verified recovery point for {app.name}", identifier)
        return {"restored_files": len(manifest["files"]), "database": app.kind, "kubernetes": kubernetes}

    def retention(self, app):
        with self.sessions() as db:
            backups = db.scalars(
                select(Backup)
                .where(Backup.app_id == app.id, Backup.status == "completed")
                .order_by(Backup.created_at.desc())
            ).all()
            for backup in backups[app.retention :]:
                active = db.scalar(select(Job).where(Job.backup_id == backup.id, Job.status.in_(["queued", "running"])))
                if active:
                    continue
                path = self.backup_dir(backup.id)
                if path.exists():
                    shutil.rmtree(path)
                backup.status = "expired"
                db.commit()
                self.event(
                    "backup.expired",
                    f"Recovery point expired under retention policy ({app.retention} retained)",
                    backup.id,
                )
            db.commit()

    def enqueue(self, kind, app_id=None, backup_id=None, detail=None):
        with self.queue_lock, self.sessions() as db:
            if kind in ("backup", "verify", "restore", "auto-recover"):
                existing = db.scalar(
                    select(Job).where(
                        Job.kind == kind,
                        Job.app_id == app_id,
                        Job.backup_id == backup_id,
                        Job.status.in_(["queued", "running"]),
                    )
                )
                if existing:
                    return serialize(existing)
            job = Job(id=uid(), kind=kind, app_id=app_id, backup_id=backup_id, detail=detail or {})
            db.add(job)
            db.commit()
            result = serialize(job)
        self.event("job.queued", f"{kind} queued", result["id"])
        return result

    def stage(self, job_id, name, progress):
        with self.sessions() as db:
            job = db.get(Job, job_id)
            job.stage = name
            job.progress = progress
            timeline = job.detail.get("timeline", [])
            job.detail = {**job.detail, "timeline": [*timeline, {"stage": name, "at": now()}]}
            db.commit()

    def process_one(self):
        with self.lock, self.sessions() as db:
            job = db.scalar(select(Job).where(Job.status == "queued").order_by(Job.created_at))
            if not job:
                return
            job.status = "running"
            job.started_at = now()
            db.commit()
            started = time.monotonic()

            def stage(name, progress):
                self.stage(job.id, name, progress)

            try:
                app = db.get(Application, job.app_id) if job.app_id else self.demo_app()
                result = {}
                if job.kind == "backup":
                    job.backup_id = self.create_backup(app, stage)
                    db.commit()
                    self.retention(app)
                elif job.kind == "verify":
                    stage("Reading and hashing stored backup", 35)
                    self.verify(job.backup_id)
                    self.event("backup.verified", "All payload checksums match", job.backup_id)
                elif job.kind == "restore":
                    # Independent rollback point remains available even if restoration fails.
                    stage("Creating pre-restore safety recovery point", 5)
                    safety = self.create_backup(app)
                    job.detail = {**job.detail, "safety_backup_id": safety}
                    db.commit()
                    result = self.restore(job.backup_id, stage, job.detail.get("restore_kubernetes", False))
                elif job.kind == "auto-recover":
                    stage("Restoring isolated workload replica target", 40)
                    self.cluster.scale(1)
                    self.cluster.wait_ready()
                    result = {"mechanism": "Replica recovery; no data restored"}
                elif job.kind == "simulation":
                    scenario = job.detail["scenario"]
                    if scenario in ("pod-failure", "application-failure"):
                        result = self.cluster.simulate(scenario, stage)
                    else:
                        before = self.notes()
                        stage("Checking disposable demo preconditions", 5)
                        if scenario == "data-loss" and not before:
                            raise ValueError("Add a demo note before running a data-loss drill")
                        identifier = self.create_backup(self.demo_app())
                        job.backup_id = identifier
                        db.commit()
                        if scenario == "corruption":
                            stage("Corrupting isolated backup copy", 35)
                            with tempfile.TemporaryDirectory(dir=self.config.data_dir / "scratch") as temp:
                                copied = Path(temp) / "copy"
                                shutil.copytree(self.backup_dir(identifier), copied)
                                with open(copied / "files.tar.gz", "ab") as stream:
                                    stream.write(b"deliberate isolated corruption")
                                try:
                                    self.verify(identifier, copied, False)
                                except ValueError:
                                    result = {"corruption_detected": True, "valid_original_preserved": True}
                                else:
                                    raise RuntimeError("Corruption was not detected")
                            stage("Verifying original recovery point remains intact", 85)
                            self.verify(identifier)
                        else:
                            stage("Deleting records in disposable demo database", 30)
                            try:
                                with self.connect_demo() as conn:
                                    conn.execute("DELETE FROM notes")
                                    conn.commit()
                                if self.notes():
                                    raise RuntimeError("Data loss was not observed")
                                stage("Data loss detected; restoring recovery point", 45)
                                self.restore(identifier, stage)
                                if self.notes() != before:
                                    raise RuntimeError("Restored dataset differs from original")
                                result = {
                                    "records_before": len(before),
                                    "records_after_loss": 0,
                                    "records_restored": len(before),
                                    "dataset_matches": True,
                                }
                            except Exception:
                                # Best-effort recovery of the isolated demo after a failed drill.
                                self.restore(identifier)
                                raise
                else:
                    raise ValueError("Unknown job type")
                db.refresh(job)  # Preserve stages written in independent transactions.
                job.status = "completed"
                job.stage = "Completed and verified"
                job.progress = 100
                job.detail = {**job.detail, "result": result}
                self.event("job.completed", f"{job.kind} completed and verified", job.id)
            except Exception as exc:
                db.refresh(job)
                job.status = "failed"
                job.stage = "Execution failed"
                # Never leak connection strings from external drivers.
                message = str(exc)
                if "postgresql://" in message or "password" in message.lower():
                    message = "Database operation failed; verify configured connection and permissions"
                job.error = message[:1000]
                self.event("job.failed", job.error, job.id, "error")
            job.finished_at = now()
            job.duration_seconds = time.monotonic() - started
            db.commit()

    def monitor_and_schedule(self):
        with self.lock, self.sessions() as db:
            for app in db.scalars(select(Application)).all():
                try:
                    self.source(app.source)
                    if app.kind == "postgres":
                        import psycopg

                        with psycopg.connect(os.environ[app.db_env], connect_timeout=3) as conn:
                            conn.execute("SELECT 1")
                    elif app.kind == "sqlite":
                        self.notes()
                    if app.demo and self.config.kube_enabled:
                        deployment = self.cluster.deployment()
                        if (
                            deployment["spec"].get("replicas", 0) == 0
                            or deployment.get("status", {}).get("availableReplicas", 0) == 0
                        ):
                            raise RuntimeError("Demo workload has no available replicas")
                    app.health = "healthy"
                    app.failures = 0
                except Exception:
                    app.failures += 1
                    app.health = "unhealthy"
                    db.commit()
                    if app.failures == app.retry_limit:
                        self.event(
                            "health.threshold",
                            f"{app.name} failed {app.failures} consecutive checks. Data restore requires confirmation.",
                            app.id,
                            "warning",
                        )
                    if app.demo and app.auto_recover and self.config.kube_enabled and app.failures >= app.retry_limit:
                        try:
                            deployment = self.cluster.deployment()
                            pending = db.scalar(
                                select(Job).where(Job.kind == "auto-recover", Job.status.in_(["queued", "running"]))
                            )
                            if deployment["spec"].get("replicas") == 0 and not pending:
                                self.enqueue("auto-recover", app.id)
                        except Exception:
                            pass
                app.last_checked = now()
                db.commit()
                last = app.last_scheduled or app.created_at
                age = (dt.datetime.now(dt.UTC) - dt.datetime.fromisoformat(last)).total_seconds()
                pending = db.scalar(
                    select(Job).where(Job.app_id == app.id, Job.kind == "backup", Job.status.in_(["queued", "running"]))
                )
                if app.enabled and age >= app.interval_minutes * 60 and not pending:
                    app.last_scheduled = now()
                    db.commit()
                    self.enqueue("backup", app.id, detail={"trigger": "scheduler"})
            db.commit()
