# Verification record

## Black-and-white UI update — 17 October 2026

- TypeScript/Vite production build and ESLint passed; Ruff passed.
- **6 component/preference tests passed**, including blocked browser storage and live device reduced-motion changes.
- **3 Playwright browser tests passed**: every route; actual backup/restore and sample-data recovery; app registration/removal; saved backup settings; desktop/mobile navigation; both monochrome appearances; saved sidebar/theme/movement preferences; and live reduced-motion updates.
- Browser checks confirmed that non-chart pages do not request chart bundles, and unchanged live messages do not trigger repeated REST reads. Operational data remains in memory only; display preferences use localStorage.
- Hashed asset responses use immutable caching, the dashboard HTML revalidates, API data uses `no-store`, and gzip compression is enabled. Cache and compression header assertions passed.
- **23 backend tests passed; 1 PostgreSQL test was skipped** because the disposable PostgreSQL test instance was stopped. The previous PostgreSQL recovery evidence below remains a record of the earlier executed test, not a new run.
- Desktop, mobile and white-theme settings screenshots were inspected. Temporary native QA services were stopped after checking; no Git commits or pushes were performed.

The earlier full-platform verification follows.

Validated locally on **15 October 2026 (Asia/Calcutta)**, Windows, Python 3.14.5 and Node.js 24.16.0. Tests used temporary isolated metadata/file stores, a dedicated local PostgreSQL 16 instance, and the actual native packaged application. No remote service was deployed and no Git operations created commits or pushed changes.

| Check | Actual result |
| --- | --- |
| Backend unit/API/integration tests | **24 passed** (`python -m pytest`, PostgreSQL test enabled) |
| PostgreSQL logical recovery | Real `pg_dump`, `pg_restore`, record comparison, and data-loss drill passed |
| Standalone Atlas Notes demo API | Health, PostgreSQL record listing and HTML view passed against the disposable database |
| SQLite recovery | Backup, source-file replacement and exact database dataset recovery passed |
| Corruption verification | Corrupted isolated copy rejected; original recovery point remained valid |
| Failure and security cases | Missing payloads, modified manifests, traversal, unsafe tar entries, incorrect confirmation, unauthorized access and cross-origin mutation rejected |
| Policy/retention/persistence | Due scheduling, duplicate-job suppression, retention exclusions, cancellation, policy persistence and interrupted-job restart handling passed |
| Failure monitoring | Repeated source failures recorded without any automatic data restoration |
| Frontend TypeScript + Vite production build | Passed; chart and motion chunks separated; largest JS chunk approximately 389 KB before gzip |
| ESLint / Ruff | Passed |
| Component tests | **3 passed** |
| Playwright packaged application tests | **2 passed**, Chromium, actual API at `http://127.0.0.1:8088` |
| Route and interaction checks | Required routes plus fallback, real backup, exact newly queued recovery/simulation jobs, confirmed restore, result inspection, application registration/removal, policy persistence, filtering and theme switching passed |
| Responsive checks | Desktop 1440 px and mobile 390 px; navigation worked and page-width overflow assertion passed |
| Browser runtime | No uncaught JavaScript errors recorded in the end-to-end recovery test |
| Native startup script | `.\scripts\start.ps1` built and started the packaged dashboard successfully |
| HTTP readiness | `/`, `/health`, `/docs` returned HTTP 200 on port 8088 |
| npm dependency audit | **0 vulnerabilities** |
| Installed Python environment audit | **No known vulnerabilities** after updating venv-only `pip` to 26.2.1 |
| Compose configuration | `docker compose config --quiet` passed |
| Kustomize | `kubectl kustomize infrastructure/kubernetes` rendered successfully |
| Kubernetes schema validation | **9 resources passed strict Kubernetes 1.31 schemas** via `kubernetes-validate` |
| CI workflow structure | YAML jobs/triggers validated locally; GitHub Actions was not run remotely |

The backend test runner emitted one dependency deprecation warning: the installed Starlette release recommends `httpx2` instead of `httpx` for its TestClient. All tests passed; no runtime failure accompanied the warning.

## Environment-dependent verification still outstanding

- **Container images and Compose service runtime:** Docker CLI is installed, but its daemon was unavailable. Image builds, generated-volume permissions, NAT/session behavior, PostgreSQL container health checks, and the optional Prometheus/Grafana services have not been executed here. Compose configuration validation alone does not prove container runtime success.
- **Live Kubernetes:** no active kube context or local cluster was available. Pod replacement, replica disruption/recovery, snapshot reapplication, operator RBAC and cluster health discovery remain unverified against a running cluster. Static schemas passed; no cluster health or successful Kubernetes recovery is claimed.
- **Remote CI:** files are prepared only. A GitHub repository and a configured trigger are required to run Actions. Nothing was committed, pushed, published or deployed.
- The implemented storage adapter is **local filesystem only**. No MinIO/S3 service, immutable storage, arbitrary PVC/block snapshots or geographically separate copy is claimed.

Port **8080 was already occupied** by another local process and was not modified. The project's default public dashboard port is **8088**. Internal Compose platform traffic uses container port 8080.

## Artifacts and cleanup

Screenshots in [screenshots/overview.png](screenshots/overview.png) and [screenshots/mobile.png](screenshots/mobile.png) show the actual running application after real validation operations. Visible recovery history was produced by executed tests, not preloaded or fabricated history. Seeded Atlas Notes records are explicitly labeled as a disposable demo.

The development preview and temporary QA platform/database processes were stopped after verification. Your existing PostgreSQL Windows service and the unrelated listener on port 8080 were left untouched. Local application data and actual recovery points remain under ignored `.data/` for your next launch.

To start the verified native application:

```powershell
.\scripts\start.ps1
```

Then open **http://127.0.0.1:8088**. The default native demo uses SQLite; PostgreSQL integration was separately verified with an isolated cluster under `.data/pg-integration`, listening only on `127.0.0.1:55432` during the tests.
