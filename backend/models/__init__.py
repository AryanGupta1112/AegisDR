import datetime as dt
import uuid

from sqlalchemy import JSON, Boolean, Float, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    return dt.datetime.now(dt.UTC).isoformat()


def uid():
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String, default="")
    kind: Mapped[str] = mapped_column(String, default="files")
    source: Mapped[str] = mapped_column(String)
    db_env: Mapped[str] = mapped_column(String, default="")
    demo: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=60)
    retention: Mapped[int] = mapped_column(Integer, default=10)
    rpo_minutes: Mapped[int] = mapped_column(Integer, default=60)
    rto_seconds: Mapped[int] = mapped_column(Integer, default=120)
    auto_recover: Mapped[bool] = mapped_column(Boolean, default=False)
    retry_limit: Mapped[int] = mapped_column(Integer, default=3)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    health: Mapped[str] = mapped_column(String, default="unknown")
    last_checked: Mapped[str | None] = mapped_column(String, nullable=True)
    last_scheduled: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Backup(Base):
    __tablename__ = "backups"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    app_id: Mapped[str] = mapped_column(String, index=True)
    app_name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    created_at: Mapped[str] = mapped_column(String, default=now)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0)
    verified_at: Mapped[str | None] = mapped_column(String, nullable=True)
    manifest: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String)
    app_id: Mapped[str | None] = mapped_column(String, nullable=True)
    backup_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    stage: Mapped[str] = mapped_column(String, default="Waiting for worker")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String, default=now)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    created_at: Mapped[str] = mapped_column(String, default=now)
    level: Mapped[str] = mapped_column(String, default="info")
    action: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(Text)
    resource_id: Mapped[str | None] = mapped_column(String, nullable=True)


def database(path):
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(engine)
    return engine, sessionmaker(engine, expire_on_commit=False)


def serialize(row):
    return {col.name: getattr(row, col.name) for col in row.__table__.columns}
