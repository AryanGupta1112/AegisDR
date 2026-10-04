import asyncio
import datetime as dt
import hmac
import ipaddress
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CollectorRegistry, Gauge, generate_latest
from sqlalchemy import select

from backend.config import Settings, settings
from backend.models import Application, Backup, Event, Job, database, now, serialize
from backend.schemas import (
    ApplicationInput,
    ApplicationOutput,
    BackupInput,
    BackupOutput,
    ClusterOutput,
    EventOutput,
    JobOutput,
    MetricsOutput,
    NoteInput,
    PolicyInput,
    RestoreInput,
    ScopeOutput,
    SettingsOutput,
    SimulationInput,
)
from backend.services.engine import RecoveryEngine


def create_app(config: Settings = settings):
    config.prepare()
    sql_engine, sessions = database(config.data_dir / "metadata.sqlite3")
    worker = RecoveryEngine(config, sessions)
    worker.last_worker_error = None
    stop = asyncio.Event()

    async def loop():
        while not stop.is_set():
            try:
                await asyncio.to_thread(worker.process_one)
                await asyncio.to_thread(worker.monitor_and_schedule)
                worker.last_worker_error = None
            except Exception:
                worker.last_worker_error = "Worker cycle failed; inspect server logs and local metadata storage"
                __import__("logging").getLogger("aegisdr").exception("Worker cycle failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=config.scheduler_interval)
            except TimeoutError:
                pass

    @asynccontextmanager
    async def lifespan(app):
        with sessions() as db:
            for job in db.scalars(select(Job).where(Job.status == "running")):
                job.status, job.error, job.stage, job.finished_at = (
                    "failed",
                    "Process interrupted; inspect safety recovery point before retrying",
                    "Interrupted by restart",
                    now(),
                )
            for backup in db.scalars(select(Backup).where(Backup.status == "running")):
                backup.status, backup.error = "failed", "Process interrupted during backup"
            db.commit()
        worker.seed()
        task = asyncio.create_task(loop())
        yield
        stop.set()
        await task  # Let an in-flight filesystem/database transaction finish before shutting down.
        sql_engine.dispose()

    app = FastAPI(title="AegisDR API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)

    @app.middleware("http")
    async def cache_policy(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/assets/") and response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.state.worker = worker
    app.state.sessions = sessions
    origins = config.origins.split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(ValueError)
    async def validation_error(request, exc):
        return Response(json.dumps({"detail": str(exc)}), status_code=422, media_type="application/json")

    def authorize(request: Request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ") or request.cookies.get(
            "aegis_session", ""
        )
        if not hmac.compare_digest(token, config.api_token):
            raise HTTPException(401, "Connect with a valid API token in Settings")
        if request.method != "GET" and request.headers.get("origin") and request.headers["origin"] not in origins:
            raise HTTPException(403, "Origin is not allowed")

    api = APIRouter(prefix="/api", dependencies=[Depends(authorize)])

    def get_row(db, model, identifier):
        row = db.get(model, identifier)
        if not row:
            raise HTTPException(404, "Resource not found")
        return row

    @app.get("/health")
    def health():
        if worker.last_worker_error:
            return Response(
                json.dumps({"status": "degraded", "service": "aegisdr"}), status_code=503, media_type="application/json"
            )
        return {"status": "ok", "service": "aegisdr"}

    @app.post("/api/session")
    def session(request: Request, response: Response):
        # Vite/NGINX proxies must retain a loopback-only listening port. No forwarded headers are trusted.
        host = request.headers.get("host", "").split(":")[0]
        peer = request.client.host if request.client else ""
        local_peer = peer in ("127.0.0.1", "::1", "testclient")
        if config.container_local_session:
            try:
                local_peer = local_peer or ipaddress.ip_address(peer).is_private
            except ValueError:
                pass
        if not config.local_mode or host not in ("localhost", "127.0.0.1", "testserver") or not local_peer:
            raise HTTPException(403, "Local session bootstrap unavailable; configure an API token")
        if request.headers.get("origin", "") not in origins:
            raise HTTPException(403, "A permitted Origin header is required")
        response.set_cookie("aegis_session", config.api_token, httponly=True, samesite="strict", max_age=86400)
        return {"connected": True, "mode": "local"}

    @api.get("/applications", response_model=list[ApplicationOutput])
    def applications():
        with sessions() as db:
            return [serialize(r) for r in db.scalars(select(Application).order_by(Application.created_at))]

    @api.post("/applications", status_code=201, response_model=ApplicationOutput)
    def register(data: ApplicationInput):
        source = worker.source(data.source, False)
        if data.kind == "postgres" and (not data.db_env or data.db_env not in os.environ):
            raise HTTPException(422, "Set the AEGIS_DB_* environment reference before registration")
        with worker.lock, sessions() as db:
            for existing in db.scalars(select(Application)):
                existing_path = worker.source(existing.source, False)
                if source.is_relative_to(existing_path) or existing_path.is_relative_to(source):
                    raise HTTPException(409, "Source overlaps an already protected application")
            source.mkdir(parents=True, exist_ok=True)
            row = Application(**data.model_dump())
            db.add(row)
            db.commit()
            worker.event("application.registered", f"Registered {row.name}", row.id)
            return serialize(row)

    @api.get("/applications/{identifier}", response_model=ApplicationOutput)
    def application(identifier: str):
        with sessions() as db:
            return serialize(get_row(db, Application, identifier))

    @api.patch("/applications/{identifier}/policy", response_model=ApplicationOutput)
    def policy(identifier: str, data: PolicyInput):
        with sessions() as db:
            row = get_row(db, Application, identifier)
            if data.auto_recover and not row.demo:
                raise HTTPException(422, "Automatic replica recovery is limited to the isolated demo")
            for key, value in data.model_dump().items():
                setattr(row, key, value)
            db.commit()
            worker.event("policy.updated", f"Updated protection policy for {row.name}", identifier)
            return serialize(row)

    @api.delete("/applications/{identifier}", status_code=204)
    def delete_application(identifier: str):
        with worker.lock, sessions() as db:
            row = get_row(db, Application, identifier)
            if row.demo:
                raise HTTPException(409, "The isolated demo cannot be unregistered")
            if db.scalar(select(Job).where(Job.app_id == identifier, Job.status.in_(["queued", "running"]))):
                raise HTTPException(409, "Application has active jobs")
            db.delete(row)
            db.commit()
            worker.event(
                "application.unregistered",
                f"Unregistered {row.name}; source data and recovery points retained",
                identifier,
            )

    @api.get("/backups", response_model=list[BackupOutput])
    def backups():
        with sessions() as db:
            return [serialize(r) for r in db.scalars(select(Backup).order_by(Backup.created_at.desc()))]

    @api.post("/backups", status_code=202, response_model=JobOutput)
    def backup(data: BackupInput):
        with sessions() as db:
            get_row(db, Application, data.app_id)
        return worker.enqueue("backup", data.app_id, detail={"trigger": "manual"})

    @api.get("/backups/{identifier}", response_model=BackupOutput)
    def backup_detail(identifier: str):
        with sessions() as db:
            return serialize(get_row(db, Backup, identifier))

    @api.post("/backups/{identifier}/verify", status_code=202, response_model=JobOutput)
    def verify(identifier: str):
        with sessions() as db:
            row = get_row(db, Backup, identifier)
            if row.status not in ("completed", "corrupted"):
                raise HTTPException(409, "Recovery point is unavailable")
        return worker.enqueue("verify", row.app_id, identifier)

    @api.get("/backups/{identifier}/scope", response_model=ScopeOutput)
    def scope(identifier: str):
        with sessions() as db:
            row = get_row(db, Backup, identifier)
            application = get_row(db, Application, row.app_id)
            return {
                "backup_id": row.id,
                "app_name": application.name,
                "confirmation": f"RESTORE {application.name}",
                "source": application.source,
                "database": application.kind,
                "payloads": list(row.manifest.get("files", {})),
                "warning": "Replaces current application files and database. A pre-restore safety recovery point is created. Kubernetes resources are only applied when explicitly selected.",
            }

    @api.post("/recovery", status_code=202, response_model=JobOutput)
    def restore(data: RestoreInput):
        with sessions() as db:
            row = get_row(db, Backup, data.backup_id)
            application = get_row(db, Application, row.app_id)
            if row.status != "completed":
                raise HTTPException(409, "Only complete recovery points can be restored")
            if data.confirmation != f"RESTORE {application.name}":
                raise HTTPException(422, "Confirmation does not match application name")
            if data.restore_kubernetes and (
                not config.kube_enabled or "kubernetes.json" not in row.manifest.get("files", {})
            ):
                raise HTTPException(422, "No enabled Kubernetes snapshot is available")
        return worker.enqueue("restore", row.app_id, row.id, {"restore_kubernetes": data.restore_kubernetes})

    @api.get("/jobs", response_model=list[JobOutput])
    def jobs():
        with sessions() as db:
            return [serialize(r) for r in db.scalars(select(Job).order_by(Job.created_at.desc()).limit(500))]

    @api.post("/jobs/{identifier}/cancel")
    def cancel(identifier: str):
        with worker.lock, sessions() as db:
            row = get_row(db, Job, identifier)
            if row.status != "queued":
                raise HTTPException(409, "Only queued jobs can be cancelled; in-flight restores must finish safely")
            row.status, row.stage, row.finished_at = "cancelled", "Cancelled before execution", now()
            db.commit()
            worker.event("job.cancelled", "Queued job cancelled", identifier)
            return serialize(row)

    @api.post("/simulations", status_code=202, response_model=JobOutput)
    def simulation(data: SimulationInput):
        if data.confirmation != "DISRUPT DEMO":
            raise HTTPException(422, "Type DISRUPT DEMO to confirm the isolated disruption")
        if data.scenario in ("pod-failure", "application-failure") and not config.kube_enabled:
            raise HTTPException(409, "This scenario requires an enabled Kubernetes integration")
        return worker.enqueue("simulation", "demo", detail={"scenario": data.scenario})

    @api.get("/demo/notes")
    def notes():
        return {"engine": worker.demo_app().kind, "notes": worker.notes()}

    @api.post("/demo/notes", status_code=201)
    def add_note(data: NoteInput):
        worker.add_note(data.text)
        return {"saved": True}

    @api.get("/clusters", response_model=ClusterOutput)
    def clusters():
        return worker.cluster.inventory()

    @api.get("/events", response_model=list[EventOutput])
    def events():
        with sessions() as db:
            return [serialize(r) for r in db.scalars(select(Event).order_by(Event.created_at.desc()).limit(1000))]

    def analytics():
        with sessions() as db:
            apps = db.scalars(select(Application)).all()
            points = db.scalars(select(Backup).order_by(Backup.created_at)).all()
            executions = db.scalars(select(Job).order_by(Job.created_at)).all()
            complete = [b for b in points if b.status == "completed"]
            failed = [b for b in points if b.status in ("failed", "corrupted")]
            recoveries = [j for j in executions if j.kind in ("restore", "auto-recover") and j.status == "completed"]
            coverage = []
            for application in apps:
                latest = next((b for b in reversed(complete) if b.app_id == application.id), None)
                observed = (
                    (dt.datetime.now(dt.UTC) - dt.datetime.fromisoformat(latest.created_at)).total_seconds() / 60
                    if latest
                    else None
                )
                recovery = next((j for j in reversed(recoveries) if j.app_id == application.id), None)
                coverage.append(
                    {
                        "app_id": application.id,
                        "name": application.name,
                        "rpo_target_minutes": application.rpo_minutes,
                        "observed_rpo_minutes": observed,
                        "rto_target_seconds": application.rto_seconds,
                        "observed_rto_seconds": recovery.duration_seconds if recovery else None,
                        "latest_recovery_point": latest.created_at if latest else None,
                    }
                )
            return {
                "applications": len(apps),
                "protected": sum(any(b.app_id == a.id for b in complete) for a in apps),
                "backups": len(complete),
                "failed_backups": len(failed),
                "success_rate": round(len(complete) / (len(complete) + len(failed)) * 100, 1)
                if complete or failed
                else None,
                "storage_bytes": sum(
                    p.stat().st_size
                    for p in (config.data_dir / "backups").rglob("*")
                    if p.is_file() and not p.is_symlink()
                ),
                "active_jobs": sum(j.status in ("queued", "running") for j in executions),
                "recoveries": len(recoveries),
                "coverage": coverage,
                "backup_series": [
                    {"at": b.created_at, "duration": b.duration_seconds, "bytes": b.size_bytes, "status": b.status}
                    for b in points
                ],
                "recovery_series": [{"at": j.finished_at, "duration": j.duration_seconds} for j in recoveries],
            }

    @api.get("/metrics", response_model=MetricsOutput)
    def metrics():
        return analytics()

    @api.get("/settings", response_model=SettingsOutput)
    def system_settings():
        return {
            "local_mode": config.local_mode,
            "storage": "local filesystem",
            "data_directory": str(config.data_dir),
            "scheduler": "Persistent local worker; one process only",
            "scheduler_interval_seconds": config.scheduler_interval,
            "kubernetes_enabled": config.kube_enabled,
            "kubernetes_namespace": config.kube_namespace,
            "demo_database": worker.demo_app().kind,
            "postgres_configured": bool(config.postgres_env),
            "operation_timeout_seconds": config.operation_timeout,
            "allowed_origins": origins,
        }

    @api.get("/stream")
    async def stream(request: Request):
        async def emit():
            while not await request.is_disconnected():
                with sessions() as db:
                    payload = [serialize(j) for j in db.scalars(select(Job).order_by(Job.created_at.desc()).limit(30))]
                yield f"event: jobs\ndata: {json.dumps(payload)}\n\n"
                await asyncio.sleep(2)

        return StreamingResponse(
            emit(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    @app.get("/metrics", dependencies=[Depends(authorize)])
    def prometheus():
        data = analytics()
        registry = CollectorRegistry()
        for name in ("backups", "failed_backups", "storage_bytes", "active_jobs", "protected", "recoveries"):
            Gauge(f"aegisdr_{name}", f"Observed {name}", registry=registry).set(data[name])
        return Response(generate_latest(registry), media_type="text/plain; version=0.0.4")

    app.include_router(api)
    frontend = Path(__file__).resolve().parents[1] / "frontend" / "dist"
    if (frontend / "index.html").is_file() and (frontend / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=frontend / "assets", check_dir=False), name="assets")

        @app.get("/favicon.svg", include_in_schema=False)
        def favicon():
            return FileResponse(frontend / "favicon.svg")

        @app.get("/{path:path}", include_in_schema=False)
        def dashboard(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "API resource not found")
            return FileResponse(frontend / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
