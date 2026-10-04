export type Application = {
  id: string;
  name: string;
  description: string;
  kind: string;
  source: string;
  db_env: string;
  demo: boolean;
  enabled: boolean;
  interval_minutes: number;
  retention: number;
  rpo_minutes: number;
  rto_seconds: number;
  auto_recover: boolean;
  retry_limit: number;
  health: string;
  failures: number;
  last_checked: string | null;
  created_at: string;
};
export type Backup = {
  id: string;
  app_id: string;
  app_name: string;
  status: string;
  created_at: string;
  size_bytes: number;
  duration_seconds: number;
  verified_at: string | null;
  manifest: {
    files?: Record<string, { sha256: string; size_bytes: number }>;
    [key: string]: unknown;
  };
  error: string | null;
};
export type Job = {
  id: string;
  kind: string;
  app_id: string | null;
  backup_id: string | null;
  status: string;
  stage: string;
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  error: string | null;
  detail: {
    scenario?: string;
    timeline?: { stage: string; at: string }[];
    result?: Record<string, unknown>;
    safety_backup_id?: string;
  };
};
export type AuditEvent = {
  id: string;
  created_at: string;
  level: string;
  action: string;
  message: string;
  resource_id: string | null;
};
export type Cluster = {
  connected: boolean;
  namespace: string;
  reason: string | null;
  items: {
    kind: string;
    name: string;
    namespace: string;
    status: Record<string, unknown>;
    managed: boolean;
  }[];
};
export type Metrics = {
  applications: number;
  protected: number;
  backups: number;
  failed_backups: number;
  success_rate: number | null;
  storage_bytes: number;
  active_jobs: number;
  recoveries: number;
  coverage: {
    app_id: string;
    name: string;
    rpo_target_minutes: number;
    observed_rpo_minutes: number | null;
    rto_target_seconds: number;
    observed_rto_seconds: number | null;
    latest_recovery_point: string | null;
  }[];
  backup_series: {
    at: string;
    duration: number;
    bytes: number;
    status: string;
  }[];
  recovery_series: { at: string; duration: number }[];
};
export type Settings = {
  local_mode: boolean;
  storage: string;
  data_directory: string;
  scheduler: string;
  scheduler_interval_seconds: number;
  kubernetes_enabled: boolean;
  kubernetes_namespace: string;
  demo_database: string;
  postgres_configured: boolean;
  operation_timeout_seconds: number;
  allowed_origins: string[];
};
export type Scope = {
  backup_id: string;
  app_name: string;
  confirmation: string;
  source: string;
  database: string;
  payloads: string[];
  warning: string;
};
