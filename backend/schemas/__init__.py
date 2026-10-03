from typing import Literal

from pydantic import BaseModel, Field


class ApplicationInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=500)
    kind: Literal["files", "postgres"] = "files"
    source: str = Field(default="", max_length=200, pattern=r"^[a-zA-Z0-9_./-]*$")
    db_env: str = Field(default="", pattern=r"^(AEGIS_DB_[A-Z0-9_]+)?$")
    interval_minutes: int = Field(default=60, ge=1, le=525600)
    retention: int = Field(default=10, ge=1, le=1000)
    rpo_minutes: int = Field(default=60, ge=1, le=525600)
    rto_seconds: int = Field(default=120, ge=1, le=86400)


class PolicyInput(BaseModel):
    enabled: bool
    interval_minutes: int = Field(ge=1, le=525600)
    retention: int = Field(ge=1, le=1000)
    rpo_minutes: int = Field(ge=1, le=525600)
    rto_seconds: int = Field(ge=1, le=86400)
    auto_recover: bool = False
    retry_limit: int = Field(default=3, ge=2, le=10)


class BackupInput(BaseModel):
    app_id: str


class RestoreInput(BaseModel):
    backup_id: str
    confirmation: str
    restore_kubernetes: bool = False


class SimulationInput(BaseModel):
    scenario: Literal["data-loss", "corruption", "pod-failure", "application-failure"]
    confirmation: str


class NoteInput(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class JobOutput(BaseModel):
    id: str
    kind: str
    app_id: str | None
    backup_id: str | None
    status: str
    stage: str
    progress: int
    created_at: str
    started_at: str | None
    finished_at: str | None
    duration_seconds: float | None
    error: str | None
    detail: dict


class ApplicationOutput(PolicyInput):
    id: str
    name: str
    description: str
    kind: str
    source: str
    db_env: str
    demo: bool
    failures: int
    health: str
    last_checked: str | None
    last_scheduled: str | None
    created_at: str


class BackupOutput(BaseModel):
    id: str
    app_id: str
    app_name: str
    status: str
    created_at: str
    size_bytes: int
    duration_seconds: float
    verified_at: str | None
    manifest: dict
    error: str | None


class ScopeOutput(BaseModel):
    backup_id: str
    app_name: str
    confirmation: str
    source: str
    database: str
    payloads: list[str]
    warning: str


class EventOutput(BaseModel):
    id: str
    created_at: str
    level: str
    action: str
    message: str
    resource_id: str | None


class ClusterResource(BaseModel):
    kind: str
    name: str
    namespace: str
    status: dict
    managed: bool


class ClusterOutput(BaseModel):
    connected: bool
    namespace: str
    reason: str | None
    items: list[ClusterResource]


class CoverageOutput(BaseModel):
    app_id: str
    name: str
    rpo_target_minutes: int
    observed_rpo_minutes: float | None
    rto_target_seconds: int
    observed_rto_seconds: float | None
    latest_recovery_point: str | None


class BackupObservation(BaseModel):
    at: str
    duration: float
    bytes: int
    status: str


class RecoveryObservation(BaseModel):
    at: str
    duration: float


class MetricsOutput(BaseModel):
    applications: int
    protected: int
    backups: int
    failed_backups: int
    success_rate: float | None
    storage_bytes: int
    active_jobs: int
    recoveries: int
    coverage: list[CoverageOutput]
    backup_series: list[BackupObservation]
    recovery_series: list[RecoveryObservation]


class SettingsOutput(BaseModel):
    local_mode: bool
    storage: str
    data_directory: str
    scheduler: str
    scheduler_interval_seconds: float
    kubernetes_enabled: bool
    kubernetes_namespace: str
    demo_database: str
    postgres_configured: bool
    operation_timeout_seconds: int
    allowed_origins: list[str]
