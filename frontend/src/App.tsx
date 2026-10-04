import {
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type FormEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { motion, MotionConfig } from "framer-motion";
import { usePreference, useSystemReducedMotion } from "./preferences";
import { refreshInterval } from "./queryClient";
import { friendly } from "./language";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Archive,
  BookOpen,
  Box,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Cloud,
  Database,
  FlaskConical,
  HardDrive,
  History,
  LayoutDashboard,
  LifeBuoy,
  LoaderCircle,
  Menu,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Sun,
  Waypoints,
  X,
  Zap,
} from "lucide-react";

import { api, bytes, date, duration } from "./api";
import {
  Badge,
  DataTable,
  Empty,
  Jobs,
  Loading,
  Modal,
  Panel,
} from "./components";
import type {
  Application,
  AuditEvent,
  Backup,
  Cluster,
  Job,
  Metrics,
  Scope,
  Settings,
} from "./types";

const BackupChartView = lazy(() =>
  import("./charts").then((module) => ({ default: module.BackupChart })),
);
const RecoveryChartView = lazy(() =>
  import("./charts").then((module) => ({ default: module.RecoveryChart })),
);
function BackupChart(props: { metrics: Metrics | undefined }) {
  return (
    <Suspense
      fallback={
        <div className="chart">
          <Loading />
        </div>
      }
    >
      <BackupChartView {...props} />
    </Suspense>
  );
}
function RecoveryChart(props: { metrics: Metrics | undefined }) {
  return (
    <Suspense
      fallback={
        <div className="chart">
          <Loading />
        </div>
      }
    >
      <RecoveryChartView {...props} />
    </Suspense>
  );
}

type Act = (path: string, body?: unknown, method?: string) => Promise<unknown>;
const navigation = [
  { name: "Home", path: "/", icon: LayoutDashboard },
  { name: "My apps", path: "/applications", icon: Box },
  { name: "Backups", path: "/backups", icon: Archive },
  { name: "Restore", path: "/recovery", icon: LifeBuoy },
  { name: "Restore history", path: "/recovery/history", icon: History },
  { name: "Practice recovery", path: "/simulations", icon: FlaskConical },
  { name: "Servers", path: "/clusters", icon: Waypoints },
  { name: "Reports", path: "/monitoring", icon: Activity },
  { name: "Recent activity", path: "/activity", icon: Clock3 },
  { name: "Settings", path: "/settings", icon: Settings2 },
];
function useData<T>(key: string) {
  return useQuery<T, Error>({
    queryKey: [key],
    queryFn: () => api<T>(`/${key}`),
    refetchInterval: refreshInterval(key),
    staleTime: key === "settings" ? 60_000 : 10_000,
  });
}

export default function App() {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const systemReduced = useSystemReducedMotion();
  const [motionSetting, setMotionSetting] = usePreference<string>(
    "aegis-motion",
    "system",
  );
  const reduced = systemReduced || motionSetting === "reduced";
  const apps = useData<Application[]>("applications");
  const backups = useData<Backup[]>("backups");
  const jobs = useData<Job[]>("jobs");
  const metrics = useData<Metrics>("metrics");
  const cluster = useData<Cluster>("clusters");
  const events = useData<AuditEvent[]>("events");
  const previousJobs = useRef<Map<string, string>>(new Map());
  const settings = useData<Settings>("settings");
  const [collapsed, setCollapsed] = usePreference<boolean>(
    "aegis-sidebar",
    false,
  );
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = usePreference<string>("aegis-theme", "dark");
  const light = theme === "light";
  const setLight = (value: boolean) => setTheme(value ? "light" : "dark");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [search, setSearch] = useState("");
  const [token, setToken] = useState("");
  useEffect(() => {
    return client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "jobs") return;
      const data = event.query.state.data as Job[] | undefined;
      if (!data) return;
      for (const job of data) {
        const previous = previousJobs.current.get(job.id);
        if (
          previous &&
          ["queued", "running"].includes(previous) &&
          ["completed", "failed"].includes(job.status)
        ) {
          setNotice({
            text:
              job.status === "completed"
                ? `${friendly(job.kind)} finished and checked.`
                : `${friendly(job.kind)} could not finish: ${job.error}`,
            error: job.status === "failed",
          });
        }
        previousJobs.current.set(job.id, job.status);
      }
    });
  }, [client]);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
  }, [light]);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const token = sessionStorage.getItem("aegis-token");
    if (token) return;
    let stream: EventSource | undefined;
    let lastPayload = "";
    const states = new Map<string, string>();
    const connect = () => {
      stream?.close();
      if (document.hidden) return;
      stream = new EventSource("/api/stream");
      stream.addEventListener("jobs", (event: MessageEvent<string>) => {
        if (event.data === lastPayload) return;
        try {
          const updates = JSON.parse(event.data) as Job[];
          if (!Array.isArray(updates)) return;
          lastPayload = event.data;
          let refresh = false;
          for (const job of updates) {
            if (states.get(job.id) !== job.status) refresh = true;
            states.set(job.id, job.status);
          }
          client.setQueryData<Job[]>(["jobs"], (previous = []) => {
            const merged = new Map(previous.map((job) => [job.id, job]));
            updates.forEach((job) => merged.set(job.id, job));
            return [...merged.values()]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, 500);
          });
          if (refresh)
            for (const key of [
              "applications",
              "backups",
              "metrics",
              "events",
              "demo/notes",
            ]) {
              void client.invalidateQueries({ queryKey: [key] });
            }
        } catch {
          /* Polling remains available if the event stream is interrupted. */
        }
      });
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    return () => {
      stream?.close();
      document.removeEventListener("visibilitychange", connect);
    };
  }, [client]);
  const act: Act = async (path, body, method = "POST") => {
    setBusy(true);
    try {
      const result = await api(path, method, body);
      setNotice({
        text:
          method === "PATCH"
            ? "Backup settings saved."
            : method === "DELETE"
              ? "App removed. Your files are safe."
              : path === "/demo/notes"
                ? "Note saved."
                : path === "/applications"
                  ? "App added."
                  : "Started. Follow its progress in the task list.",
        error: false,
      });
      const keys = path.includes("/policy")
        ? ["applications", "metrics", "events"]
        : path === "/demo/notes"
          ? ["demo/notes", "events"]
          : path.startsWith("/applications")
            ? ["applications", "metrics", "events"]
            : ["jobs", "backups", "metrics", "events"];
      await Promise.all(
        keys.map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      return result;
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const perform = (path: string, body?: unknown, method?: string) => {
    void act(path, body, method).catch(() => undefined);
  };
  const preview = async (id: string) => {
    try {
      setScope(await api<Scope>(`/backups/${id}/scope`));
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
    }
  };
  const appRows = apps.data || [];
  const backupRows = backups.data || [];
  const jobRows = jobs.data || [];
  const current =
    navigation
      .filter((n) =>
        n.path === "/"
          ? location.pathname === "/"
          : location.pathname.startsWith(n.path),
      )
      .at(-1)?.name || "Page not found";
  const common = {
    apps: appRows,
    backups: backupRows,
    jobs: jobRows,
    act,
    perform,
    preview,
    busy,
  };
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {mobile && (
          <button
            className="drawer-scrim"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={`sidebar ${mobile ? "open" : ""}`}>
          <Link className="brand" to="/" aria-label="AegisDR overview">
            <span className="brand-mark">
              <ShieldCheck size={24} />
            </span>
            <span>
              Aegis<span className="brand-dr">DR</span>
              <small>BACKUP & RESTORE</small>
            </span>
          </Link>
          <button
            className="mobile-close icon-button"
            aria-label="Close menu"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
          <div className="nav-label">YOUR SPACE</div>
          <nav aria-label="Primary navigation">
            {navigation.map((n, i) => (
              <NavLink
                key={n.path}
                to={n.path}
                end={n.path !== "/applications" && n.path !== "/backups"}
                onClick={() => setMobile(false)}
                title={collapsed ? n.name : undefined}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""} ${i === 5 ? "nav-break" : ""}`
                }
              >
                <n.icon size={19} />
                <span>{n.name}</span>
                {n.name === "Backups" && (
                  <small>{metrics.data?.backups || 0}</small>
                )}
                {n.name === "Practice recovery" && <i className="nav-dot" />}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-workspace">
              <span className="local-icon">
                <Server size={18} />
              </span>
              <span>
                This computer<small>Private on this device</small>
              </span>
              <span className="status-dot" />
            </div>
            <button
              className="collapse-button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeftClose size={17} />
              <span>Collapse sidebar</span>
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="icon-button mobile-menu"
                aria-label="Open menu"
                onClick={() => setMobile(true)}
              >
                <Menu />
              </button>
              <Cloud size={17} />
              <span>My space</span>
              <ChevronRight size={14} />
              <strong>{current}</strong>
            </div>
            <div className="top-actions">
              <div className="global-search">
                <Search size={16} />
                <input
                  aria-label="Find an app or backup"
                  placeholder="Find an app or backup…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <div className="search-results">
                    {appRows
                      .filter((a) =>
                        a.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((a) => (
                        <Link
                          key={a.id}
                          to={`/applications/${a.id}`}
                          onClick={() => setSearch("")}
                        >
                          <Box size={16} />
                          {a.name}
                        </Link>
                      ))}
                    {backupRows
                      .filter((b) =>
                        `${b.id} ${b.app_name}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .slice(0, 5)
                      .map((b) => (
                        <Link
                          key={b.id}
                          to={`/backups/${b.id}`}
                          onClick={() => setSearch("")}
                        >
                          <Archive size={16} />
                          {b.app_name} · {b.id.slice(0, 6)}
                        </Link>
                      ))}
                    {!appRows.some((a) =>
                      a.name.toLowerCase().includes(search.toLowerCase()),
                    ) &&
                      !backupRows.some((b) =>
                        `${b.id} ${b.app_name}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      ) && <p>No matching resources</p>}
                  </div>
                )}
              </div>
              <span className={`connection ${apps.isError ? "offline" : ""}`}>
                <i />
                {apps.isError ? "Disconnected" : "Connected"}
              </span>
              <button
                className="icon-button"
                aria-label={
                  light ? "Switch to dark theme" : "Switch to light theme"
                }
                onClick={() => setLight(!light)}
              >
                {light ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <Link
                to="/activity"
                className="avatar"
                aria-label="View workspace activity"
              >
                L
              </Link>
            </div>
          </header>
          <motion.main
            key={location.pathname}
            id="main"
            className="main"
            initial={
              reduced ? false : { opacity: 0.65, transform: "translateY(6px)" }
            }
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="page-heading">
              <div>
                <h1>
                  {location.pathname === "/"
                    ? "Your backups, at a glance."
                    : current}
                </h1>
                <p>
                  {location.pathname === "/"
                    ? "Keep your apps safe. Save a backup, check it, and restore when needed."
                    : descriptions[current] || "View your app and its backups."}
                </p>
              </div>
              <div className="heading-actions">
                {location.pathname === "/" && (
                  <span className="live-label">
                    <span className="status-dot" />
                    LIVE
                  </span>
                )}
                {["/", "/applications"].includes(location.pathname) && (
                  <button className="primary" onClick={() => setRegister(true)}>
                    <Plus size={16} />
                    Add app
                  </button>
                )}
                {location.pathname === "/backups" && (
                  <BackupButton apps={appRows} busy={busy} perform={perform} />
                )}
              </div>
            </div>
            {apps.isPending ? (
              <Loading />
            ) : apps.isError ? (
              <Panel
                title="Connect your workspace"
                description="The backup service is offline or needs an access code. Start the service, then reconnect."
              >
                <p className="error-box">{apps.error.message}</p>
                <form
                  className="connection-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sessionStorage.setItem("aegis-token", token);
                    void client.invalidateQueries();
                  }}
                >
                  <label>
                    Access code
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Required outside local mode"
                    />
                  </label>
                  <button className="primary">Connect</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      sessionStorage.removeItem("aegis-token");
                      void fetch("/api/session", { method: "POST" }).then(() =>
                        client.invalidateQueries(),
                      );
                    }}
                  >
                    Retry local connection
                  </button>
                </form>
              </Panel>
            ) : (
              <Routes>
                <Route
                  path="/"
                  element={
                    <Overview
                      {...common}
                      metrics={metrics.data}
                      cluster={cluster.data}
                      events={events.data || []}
                    />
                  }
                />
                <Route
                  path="/applications"
                  element={<Applications {...common} />}
                />
                <Route
                  path="/applications/:id"
                  element={<ApplicationDetails {...common} />}
                />
                <Route
                  path="/backups"
                  element={
                    <Panel
                      title="Saved backups"
                      description="Your saved files and records, with the result of their latest check."
                    >
                      <BackupTable
                        backups={backupRows}
                        perform={perform}
                        preview={preview}
                      />
                    </Panel>
                  }
                />
                <Route
                  path="/backups/:id"
                  element={
                    <BackupDetails
                      backups={backupRows}
                      perform={perform}
                      preview={preview}
                    />
                  }
                />
                <Route
                  path="/recovery"
                  element={<Recovery {...common} metrics={metrics.data} />}
                />
                <Route
                  path="/recovery/history"
                  element={
                    <Panel
                      title="Restore history"
                      description="Completed restores and app restarts, with their actual results."
                    >
                      <Jobs
                        jobs={jobRows.filter((j) =>
                          ["restore", "auto-recover"].includes(j.kind),
                        )}
                        cancel={(id) => perform(`/jobs/${id}/cancel`)}
                      />
                    </Panel>
                  }
                />
                <Route
                  path="/simulations"
                  element={
                    <Simulations
                      jobs={jobRows}
                      act={act}
                      busy={busy}
                      kube={settings.data?.kubernetes_enabled || false}
                    />
                  }
                />
                <Route
                  path="/clusters"
                  element={<Clusters cluster={cluster.data} />}
                />
                <Route
                  path="/monitoring"
                  element={<Monitoring metrics={metrics.data} />}
                />
                <Route
                  path="/activity"
                  element={
                    <Panel
                      title="Recent changes"
                      description="Changes and task results, saved as they happen."
                    >
                      <DataTable
                        rows={events.data || []}
                        searchText={(e) =>
                          `${friendly(e.action.replaceAll(".", " "))} ${e.message} ${e.level}`
                        }
                        columns={[
                          {
                            label: "Event",
                            render: (e) => (
                              <>
                                <strong>
                                  {friendly(e.action.replaceAll(".", " "))}
                                </strong>
                                <small>
                                  {e.resource_id?.slice(0, 12) || "workspace"}
                                </small>
                              </>
                            ),
                          },
                          { label: "Message", render: (e) => e.message },
                          {
                            label: "Level",
                            render: (e) => <Badge status={e.level} />,
                          },
                          {
                            label: "Recorded",
                            render: (e) => date(e.created_at),
                          },
                        ]}
                      />
                    </Panel>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <SystemSettings
                      settings={settings.data}
                      apps={appRows}
                      act={act}
                      motionSetting={motionSetting}
                      setMotionSetting={setMotionSetting}
                    />
                  }
                />
                <Route
                  path="*"
                  element={
                    <Empty title="This page was not found">
                      <Link className="primary" to="/">
                        Go home <ArrowRight size={16} />
                      </Link>
                    </Empty>
                  }
                />
              </Routes>
            )}
            <footer className="footer">
              <span>
                <Shield size={13} />
                AegisDR · Backup & restore
              </span>
              <span>Saved safely. Checked carefully.</span>
              <a href="/docs" target="_blank" rel="noreferrer">
                Technical guide <BookOpen size={13} />
              </a>
            </footer>
          </motion.main>
        </div>
        {register && (
          <Registration
            act={act}
            busy={busy}
            onClose={() => setRegister(false)}
            onSaved={(id) => {
              setRegister(false);
              navigate(`/applications/${id}`);
            }}
          />
        )}
        {scope && (
          <RestoreDialog
            scope={scope}
            busy={busy}
            act={act}
            onClose={() => setScope(null)}
          />
        )}
        {notice && (
          <motion.div
            initial={
              reduced ? false : { transform: "translateY(8px)", opacity: 0 }
            }
            animate={{ transform: "translateY(0px)", opacity: 1 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            role={notice.error ? "alert" : "status"}
            className={`toast ${notice.error ? "toast-error" : ""}`}
          >
            {notice.error ? <X size={18} /> : <CheckCheck size={18} />}
            <span>{notice.text}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </div>
    </MotionConfig>
  );
}

const descriptions: Record<string, string> = {
  "My apps": "Choose an app to see its files, backups, and settings.",
  Backups: "Save a copy of your data so you can bring it back later.",
  Restore:
    "Choose a saved backup, review what will change, and bring your data back.",
  "Restore history": "See what was restored and how long it took.",
  "Practice recovery": "Try a safe recovery exercise with sample data.",
  Servers: "Optional connections to the computers running your apps.",
  Reports: "See backup results, storage use, and restore times.",
  "Recent activity": "See what happened, when it happened, and the result.",
  Settings: "Choose backup schedules and make this space comfortable for you.",
};
type Common = {
  apps: Application[];
  backups: Backup[];
  jobs: Job[];
  act: Act;
  perform: (path: string, body?: unknown, method?: string) => void;
  preview: (id: string) => void;
  busy: boolean;
};
function BackupButton({
  apps,
  perform,
  busy,
}: {
  apps: Application[];
  perform: Common["perform"];
  busy: boolean;
}) {
  const [id, setId] = useState("");
  const selected = id || apps[0]?.id;
  return (
    <div className="inline-actions">
      <select
        aria-label="App to back up"
        value={selected || ""}
        onChange={(e) => setId(e.target.value)}
      >
        {apps.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        className="primary"
        disabled={busy || !selected}
        onClick={() => perform("/backups", { app_id: selected })}
      >
        <Plus size={16} />
        Create backup
      </button>
    </div>
  );
}
function Overview(
  props: Common & {
    metrics: Metrics | undefined;
    cluster: Cluster | undefined;
    events: AuditEvent[];
  },
) {
  const { metrics: m, backups, apps, jobs, cluster, events } = props;
  const complete = backups.filter((b) => b.status === "completed");
  const latest = complete[0];
  return (
    <>
      <div className="start-guide">
        <p>
          <strong>New here?</strong> Try the sample app before adding your own
          data.
        </p>
        <Link to="/applications/demo">1. View sample notes</Link>
        <Link to="/backups">2. Save a backup</Link>
        <Link to="/recovery">3. Restore a copy</Link>
      </div>
      <section className="resilience-banner">
        <div className="banner-copy">
          <div className="banner-symbol">
            <ShieldCheck size={25} />
          </div>
          <div>
            <h2>
              {complete.length
                ? "A backup you can trust."
                : "Start with your first backup."}
            </h2>
            <p>
              {latest
                ? `Latest checked backup for ${latest.app_name} · ${date(latest.created_at)}`
                : "Choose an app and save a backup. You can restore it if something goes wrong."}
            </p>
            <Link to={latest ? `/backups/${latest.id}` : "/backups"}>
              {latest ? "Open backup" : "Create a backup"}
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
        <div className="protection-path">
          <div className="path-node">
            <Box size={19} />
            <span>Protect</span>
            <small>
              {apps.length} {apps.length === 1 ? "app" : "apps"}
            </small>
          </div>
          <div className="path-line" />
          <div className={`path-node ${complete.length ? "verified" : ""}`}>
            <Archive size={19} />
            <span>Save</span>
            <small>{complete.length} backups</small>
          </div>
          <div className="path-line" />
          <div className="path-node">
            <ShieldCheck size={19} />
            <span>Restore</span>
            <small>{m?.recoveries || 0} verified restores</small>
          </div>
        </div>
      </section>
      <div className="metric-grid">
        {[
          {
            label: "Your apps",
            value: `${m?.protected || 0} / ${apps.length}`,
            sub: "With a complete backup",
            icon: Box,
          },
          {
            label: "Verified backups",
            value: String(m?.backups || 0),
            sub:
              m?.success_rate == null
                ? "No completed attempts"
                : `${m.success_rate}% of saved backup attempts succeeded`,
            icon: Archive,
          },
          {
            label: "Backup storage",
            value: bytes(m?.storage_bytes || 0),
            sub: "Space used on this computer",
            icon: HardDrive,
          },
          {
            label: "Tasks in progress",
            value: String(m?.active_jobs || 0),
            sub: "Tasks run safely, one at a time",
            icon: Zap,
          },
        ].map((x) => (
          <div className="metric" key={x.label}>
            <div>
              <span>{x.label}</span>
              <x.icon size={18} />
            </div>
            <strong>{x.value}</strong>
            <small>{x.sub}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <Panel
          title="Time to save a backup"
          description="Time taken · actual recorded backups"
          action={
            <Link className="subtle" to="/monitoring">
              View analytics <ArrowRight size={14} />
            </Link>
          }
        >
          <BackupChart metrics={m} />
        </Panel>
        <Panel
          title="Connection check"
          description="What is available right now"
        >
          <div className="readiness-row">
            <span className="readiness-icon">
              <Database size={19} />
            </span>
            <div>
              <strong>Backup service</strong>
              <small>Files and saved tasks on this computer</small>
            </div>
            <Badge status="connected" />
          </div>
          <div className="readiness-row">
            <span className="readiness-icon">
              <Waypoints size={19} />
            </span>
            <div>
              <strong>Optional server</strong>
              <small>{cluster?.namespace || "No server connected"}</small>
            </div>
            <Badge status={cluster?.connected ? "connected" : "unavailable"} />
          </div>
          <div className="readiness-row">
            <span className="readiness-icon">
              <Box size={19} />
            </span>
            <div>
              <strong>App availability</strong>
              <small>
                {apps.filter((a) => a.health === "healthy").length} healthy ·{" "}
                {apps.filter((a) => a.health === "unknown").length} pending
              </small>
            </div>
            <Link className="text-button" to="/applications">
              View details <ArrowRight size={14} />
            </Link>
          </div>
          <div className="environment-note">
            <Shield size={16} />
            <p>
              Data restoration always requires explicit confirmation. Recovery
              drills use the isolated demo.
            </p>
          </div>
        </Panel>
      </div>
      <Panel
        title="Recent backups"
        description="See when your backups were saved and checked"
        action={
          <Link to="/backups" className="subtle">
            All backups <ArrowRight size={14} />
          </Link>
        }
      >
        <BackupTable
          backups={backups.slice(0, 5)}
          perform={props.perform}
          preview={props.preview}
        />
      </Panel>
      <div className="dashboard-grid">
        <Panel
          title="Recent tasks"
          description="Backups, file checks and restores"
        >
          <Jobs
            jobs={jobs.slice(0, 5)}
            cancel={(id) => props.perform(`/jobs/${id}/cancel`)}
          />
        </Panel>
        <Panel
          title="What happened recently"
          action={
            <Link to="/activity" className="subtle">
              View all
            </Link>
          }
        >
          {events.slice(0, 5).map((e) => (
            <div className="activity-item" key={e.id}>
              <span className={`event-dot ${e.level}`} />
              <div>
                <p>{e.message}</p>
                <small>{date(e.created_at)}</small>
              </div>
            </div>
          ))}
          {!events.length && <Empty title="No events yet" />}
        </Panel>
      </div>
    </>
  );
}
function BackupTable({
  backups,
  perform,
  preview,
}: {
  backups: Backup[];
  perform: Common["perform"];
  preview: (id: string) => void;
}) {
  return (
    <DataTable
      rows={backups}
      searchText={(b) => `${b.app_name} ${b.id} ${b.status}`}
      empty="No backups yet"
      columns={[
        {
          label: "Backup",
          render: (b) => (
            <Link className="resource-name" to={`/backups/${b.id}`}>
              <span className="resource-icon">
                <Archive size={17} />
              </span>
              <span>
                {b.app_name}
                <small>{b.id.slice(0, 12)}</small>
              </span>
            </Link>
          ),
        },
        { label: "Status", render: (b) => <Badge status={b.status} /> },
        { label: "Created", render: (b) => date(b.created_at) },
        { label: "Size", render: (b) => bytes(b.size_bytes) },
        { label: "Duration", render: (b) => duration(b.duration_seconds) },
        {
          label: "Actions",
          render: (b) => (
            <div className="row-actions">
              <button
                className="subtle"
                disabled={!["completed", "corrupted"].includes(b.status)}
                onClick={() => perform(`/backups/${b.id}/verify`)}
              >
                Check
              </button>
              <button
                className="subtle"
                disabled={b.status !== "completed"}
                onClick={() => preview(b.id)}
              >
                Restore <ArrowRight size={13} />
              </button>
            </div>
          ),
        },
      ]}
    />
  );
}
function Applications({ apps, perform }: Common) {
  return (
    <Panel
      title="Your apps"
      description="Add apps and choose which folders or databases to protect."
    >
      <DataTable
        rows={apps}
        searchText={(a) => `${a.name} ${friendly(a.kind)} ${a.health}`}
        empty="Add your first app"
        columns={[
          {
            label: "Application",
            render: (a) => (
              <Link className="resource-name" to={`/applications/${a.id}`}>
                <span className="resource-icon">
                  <Box size={18} />
                </span>
                <span>
                  {a.name}
                  <small>
                    {a.demo ? "PRACTICE APP" : a.description || a.source}
                  </small>
                </span>
              </Link>
            ),
          },
          {
            label: "Source",
            render: (a) => (
              <>
                <strong>{friendly(a.kind)}</strong>
                <small>{a.source}</small>
              </>
            ),
          },
          { label: "Health", render: (a) => <Badge status={a.health} /> },
          {
            label: "Schedule",
            render: (a) => (
              <>
                {a.enabled ? `Every ${a.interval_minutes} min` : "Paused"}
                <small>{a.retention} backups kept</small>
              </>
            ),
          },
          {
            label: "Actions",
            render: (a) => (
              <button
                className="secondary"
                onClick={() => perform("/backups", { app_id: a.id })}
              >
                <Archive size={14} />
                Back up
              </button>
            ),
          },
        ]}
      />
    </Panel>
  );
}
function ApplicationDetails(props: Common) {
  const { id } = useParams();
  const app = props.apps.find((a) => a.id === id);
  const [remove, setRemove] = useState(false);
  if (!app)
    return (
      <Empty title="App not found">
        <Link to="/applications">View applications</Link>
      </Empty>
    );
  return (
    <>
      <div className="detail-hero">
        <div className="detail-icon">
          <Box size={30} />
        </div>
        <div>
          <h2>{app.name}</h2>
          <p>{app.description || `Protected source: ${app.source}`}</p>
        </div>
        <Badge status={app.health} />
        <button
          className="primary"
          disabled={props.busy}
          onClick={() => props.perform("/backups", { app_id: app.id })}
        >
          <Archive size={16} />
          Back up now
        </button>
      </div>
      <div className="dashboard-grid">
        <Panel
          title="Backup settings"
          description="Backups run automatically while this service is open."
        >
          <Policy
            key={`${app.id}-${app.interval_minutes}-${app.enabled}-${app.retention}`}
            app={app}
            act={props.act}
          />
        </Panel>
        <Panel title="Files and data">
          <dl className="definition-list">
            <dt>Folder</dt>
            <dd>
              <code>protected/{app.source}</code>
            </dd>
            <dt>Data storage</dt>
            <dd>{friendly(app.kind)}</dd>
            <dt>Last availability check</dt>
            <dd>{date(app.last_checked)}</dd>
            <dt>Failed checks</dt>
            <dd>{app.failures}</dd>
            <dt>Registered</dt>
            <dd>{date(app.created_at)}</dd>
            <dt>Saved connection name</dt>
            <dd>{app.db_env || "Not needed"}</dd>
          </dl>
          {!app.demo && (
            <button className="danger-button" onClick={() => setRemove(true)}>
              Remove app
            </button>
          )}
          {app.demo && <DemoNotes act={props.act} />}
        </Panel>
      </div>
      <Panel title="Backups for this app">
        <BackupTable
          backups={props.backups.filter((b) => b.app_id === app.id)}
          perform={props.perform}
          preview={props.preview}
        />
      </Panel>
      <Panel title="Tasks for this app">
        <Jobs
          jobs={props.jobs.filter((j) => j.app_id === app.id)}
          cancel={(id) => props.perform(`/jobs/${id}/cancel`)}
        />
      </Panel>
      {remove && (
        <Modal title="Remove app?" onClose={() => setRemove(false)}>
          <p>
            Remove {app.name} from protection. Source files and existing backups
            remain on disk. Restoring requires registering the application
            again.
          </p>
          <button
            className="danger-button"
            onClick={() => {
              props.perform(`/applications/${app.id}`, undefined, "DELETE");
              setRemove(false);
            }}
          >
            Remove {app.name}
          </button>
        </Modal>
      )}
    </>
  );
}
function Policy({ app, act }: { app: Application; act: Act }) {
  const [values, setValues] = useState({
    enabled: app.enabled,
    interval_minutes: app.interval_minutes,
    retention: app.retention,
    rpo_minutes: app.rpo_minutes,
    rto_seconds: app.rto_seconds,
    auto_recover: app.auto_recover,
    retry_limit: app.retry_limit,
  });
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        void act(`/applications/${app.id}/policy`, values, "PATCH")
          .catch(() => undefined)
          .finally(() => setSaving(false));
      }}
    >
      <label className="check-label full">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => setValues({ ...values, enabled: e.target.checked })}
        />
        Save backups automatically
      </label>
      {(
        [
          {
            key: "interval_minutes",
            name: "Save a backup every (minutes)",
            max: 525600,
          },
          { key: "retention", name: "Number of backups to keep", max: 1000 },
          {
            key: "rpo_minutes",
            name: "Maximum data age (minutes)",
            max: 525600,
          },
          {
            key: "rto_seconds",
            name: "Target restore time (seconds)",
            max: 86400,
          },
          {
            key: "retry_limit",
            name: "Failed checks before a restart",
            max: 10,
          },
        ] as const
      ).map((f) => (
        <label key={f.key}>
          {f.name}
          <input
            required
            type="number"
            min={f.key === "retry_limit" ? 2 : 1}
            max={f.max}
            value={values[f.key]}
            onChange={(e) =>
              setValues({ ...values, [f.key]: Number(e.target.value) })
            }
          />
        </label>
      ))}
      {app.demo && (
        <label className="check-label full">
          <input
            type="checkbox"
            checked={values.auto_recover}
            onChange={(e) =>
              setValues({ ...values, auto_recover: e.target.checked })
            }
          />
          Restart the practice app if it goes offline
        </label>
      )}
      <p className="form-note full">
        Automatic restart only affects the practice app after repeated failed
        checks. Replacing saved records always needs your confirmation.
      </p>
      <button className="primary" disabled={saving}>
        {saving ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Check size={16} />
        )}
        Save backup settings
      </button>
    </form>
  );
}
function BackupDetails({
  backups,
  perform,
  preview,
}: {
  backups: Backup[];
  perform: Common["perform"];
  preview: (id: string) => void;
}) {
  const { id } = useParams();
  const point = backups.find((b) => b.id === id);
  if (!point) return <Empty title="Backup not found" />;
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(point.manifest, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `aegisdr-${point.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="detail-hero">
        <div className="detail-icon">
          <Archive size={30} />
        </div>
        <div>
          <h2>{point.app_name}</h2>
          <p>Backup · {point.id}</p>
        </div>
        <Badge status={point.status} />
        <button
          className="primary"
          disabled={point.status !== "completed"}
          onClick={() => preview(point.id)}
        >
          Restore this point <ArrowRight size={16} />
        </button>
      </div>
      {point.error && <p className="error-box">{point.error}</p>}
      <Panel
        title="Backup contents"
        description="We compare each saved file with its original fingerprint to check for changes."
        action={
          <button className="secondary" onClick={download}>
            <ArrowDownToLine size={15} />
            Download file details
          </button>
        }
      >
        <dl className="definition-list">
          <dt>Created</dt>
          <dd>{date(point.created_at)}</dd>
          <dt>Verified</dt>
          <dd>{date(point.verified_at)}</dd>
          <dt>Stored size</dt>
          <dd>{bytes(point.size_bytes)}</dd>
          <dt>Time taken</dt>
          <dd>{duration(point.duration_seconds)}</dd>
        </dl>
        <DataTable
          rows={Object.entries(point.manifest.files || {})}
          columns={[
            { label: "File", render: ([name]) => <code>{name}</code> },
            { label: "Size", render: ([, info]) => bytes(info.size_bytes) },
            {
              label: "File check details",
              render: ([, info]) => (
                <details className="file-check">
                  <summary>View fingerprint</summary>
                  <code className="checksum">{info.sha256}</code>
                </details>
              ),
            },
          ]}
        />
        <button
          className="secondary"
          disabled={!["completed", "corrupted"].includes(point.status)}
          onClick={() => perform(`/backups/${point.id}/verify`)}
        >
          <ShieldCheck size={16} />
          Check backup files
        </button>
      </Panel>
    </>
  );
}
function Recovery(props: Common & { metrics: Metrics | undefined }) {
  return (
    <>
      <div className="workflow-strip">
        <span>
          <Search size={18} />
          Choose a backup
        </span>
        <ChevronRight size={17} />
        <span>
          <ShieldCheck size={18} />
          Review what will change
        </span>
        <ChevronRight size={17} />
        <span>
          <LifeBuoy size={18} />
          Restore and check
        </span>
      </div>
      <div className="info-box">
        <Shield size={19} />
        <p>
          Restoration replaces application files and database content. A safety
          backup is created first. Healthy data is never restored automatically.
        </p>
      </div>
      <Panel
        title="Backups you can restore"
        description="Choose a finished backup to see exactly what it will replace."
      >
        <BackupTable
          backups={props.backups.filter((b) => b.status === "completed")}
          perform={props.perform}
          preview={props.preview}
        />
      </Panel>
      <Panel
        title="Your recovery goals"
        description="Compare your goals with real results. Restore time appears after a successful restore."
      >
        <Objectives metrics={props.metrics} />
      </Panel>
      <Panel title="Restore progress">
        <Jobs
          jobs={props.jobs.filter((j) =>
            ["restore", "auto-recover"].includes(j.kind),
          )}
          cancel={(id) => props.perform(`/jobs/${id}/cancel`)}
        />
      </Panel>
    </>
  );
}
function RestoreDialog({
  scope,
  busy,
  act,
  onClose,
}: {
  scope: Scope;
  busy: boolean;
  act: Act;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [kube, setKube] = useState(false);
  return (
    <Modal title="Review what will be replaced" onClose={onClose}>
      <p className="warning-box">
        This will replace the current files and records in {scope.app_name} with
        this backup. We save a safety backup first. Review the details before
        you continue.
      </p>
      <dl className="definition-list">
        <dt>Application</dt>
        <dd>{scope.app_name}</dd>
        <dt>Backup</dt>
        <dd>
          <code>{scope.backup_id.slice(0, 16)}</code>
        </dd>
        <dt>Files replaced</dt>
        <dd>protected/{scope.source}</dd>
        <dt>Database</dt>
        <dd>{friendly(scope.database)}</dd>
        <dt>Saved files</dt>
        <dd>{scope.payloads.join(", ")}</dd>
      </dl>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act("/recovery", {
            backup_id: scope.backup_id,
            confirmation,
            restore_kubernetes: kube,
          })
            .then(onClose)
            .catch(() => undefined);
        }}
      >
        {scope.payloads.includes("kubernetes.json") && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={kube}
              onChange={(e) => setKube(e.target.checked)}
            />
            Also restore the practice server setup
          </label>
        )}
        <label>
          Type <strong>{scope.confirmation}</strong> to confirm replacement
          <input
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={busy || confirmation !== scope.confirmation}
          >
            Confirm restore <LifeBuoy size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DemoNotes({ act }: { act: Act }) {
  const notes = useData<{
    engine: string;
    notes: { id: string; text: string }[];
  }>("demo/notes");
  const [text, setText] = useState("");
  return (
    <div className="demo-notes">
      <h3>
        Practice notes <Badge status={notes.data?.engine || "unknown"} />
      </h3>
      <p>These sample notes are real. Use them to try a backup and restore.</p>
      {notes.data?.notes.map((n) => (
        <div className="note" key={n.id}>
          <Database size={14} />
          {n.text}
        </div>
      ))}
      {notes.isError && <p className="error-box">{notes.error.message}</p>}
      <form
        className="inline-actions"
        onSubmit={(e) => {
          e.preventDefault();
          void act("/demo/notes", { text })
            .then(() => setText(""))
            .catch(() => undefined);
        }}
      >
        <input
          aria-label="New demo note"
          placeholder="Write a practice note…"
          value={text}
          maxLength={500}
          required
          onChange={(e) => setText(e.target.value)}
        />
        <button className="secondary" disabled={!text.trim()}>
          <Plus size={16} />
          Add note
        </button>
      </form>
    </div>
  );
}
function Simulations({
  jobs,
  act,
  busy,
  kube,
}: {
  jobs: Job[];
  act: Act;
  busy: boolean;
  kube: boolean;
}) {
  const [scenario, setScenario] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const scenarios = [
    {
      id: "pod-failure",
      name: "Stopped app copy",
      icon: Box,
      tag: "Automatic replacement",
      text: "Stop one practice app copy and watch the server replace it.",
      requires: true,
    },
    {
      id: "data-loss",
      name: "Lost records",
      icon: Database,
      tag: "Restore missing records",
      text: "Back up demo records, delete them, restore the backup, and compare the exact dataset.",
      requires: false,
    },
    {
      id: "application-failure",
      name: "App goes offline",
      icon: Server,
      tag: "Restart the app",
      text: "Take the practice app offline, bring it back, and check that it is available.",
      requires: true,
    },
    {
      id: "corruption",
      name: "Damaged backup",
      icon: Shield,
      tag: "Check for damaged files",
      text: "Damage a separate backup copy and check that the damage is detected. The original stays safe.",
      requires: false,
    },
  ];
  return (
    <>
      <div className="info-box">
        <FlaskConical size={20} />
        <p>
          These exercises only change the Atlas Notes practice app or a separate
          backup copy. Your other apps are not used. Server exercises need a
          connected server.
        </p>
      </div>
      <div className="scenario-grid">
        {scenarios.map((s) => (
          <section className="scenario" key={s.id}>
            <div className="scenario-top">
              <s.icon size={24} />
              <span>{s.tag}</span>
            </div>
            <h2>{s.name}</h2>
            <p>{s.text}</p>
            <div className="scenario-precondition">
              <strong>Before you start</strong>
              <span>
                {s.requires
                  ? "Server connected and practice app running"
                  : s.id === "data-loss"
                    ? "At least one practice note and space to save a backup"
                    : "Space for a separate practice backup"}
              </span>
            </div>
            <button
              className="secondary"
              disabled={s.requires && !kube}
              onClick={() => {
                setScenario(s.id);
                setConfirmation("");
              }}
            >
              {s.requires && !kube
                ? "Connect a server first"
                : "Try this exercise"}
              <ArrowRight size={15} />
            </button>
          </section>
        ))}
      </div>
      <Panel
        title="Your practice app"
        description="See your sample notes before and after a recovery exercise."
      >
        <DemoNotes act={act} />
      </Panel>
      <Panel
        title="Practice history"
        description="Open a task to see each step and its result."
      >
        <Jobs jobs={jobs.filter((j) => j.kind === "simulation")} />
      </Panel>
      {scenario && (
        <Modal
          title={`Practice: ${scenarios.find((s) => s.id === scenario)?.name}`}
          onClose={() => setScenario(null)}
        >
          <p className="warning-box">
            This exercise changes only the practice app. Before removing sample
            records, we save a real backup so they can be restored.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("/simulations", { scenario, confirmation })
                .then(() => setScenario(null))
                .catch(() => undefined);
            }}
          >
            <label>
              Type <strong>DISRUPT DEMO</strong> to confirm this practice-only
              change
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setScenario(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={busy || confirmation !== "DISRUPT DEMO"}
              >
                Start practice <FlaskConical size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Clusters({ cluster }: { cluster: Cluster | undefined }) {
  if (!cluster) return <Loading />;
  return (
    <>
      <div className="detail-hero">
        <div className="detail-icon">
          <Waypoints size={30} />
        </div>
        <div>
          <h2>{cluster.namespace}</h2>
          <p>
            Optional Kubernetes connection for app monitoring and restart
            exercises
          </p>
        </div>
        <Badge status={cluster.connected ? "connected" : "unavailable"} />
      </div>
      {!cluster.connected && (
        <div className="warning-box">
          <h3>No server connected</h3>
          <p>
            You can still save files, restore notes, and try the basic recovery
            exercises.
          </p>
          <details className="advanced">
            <summary>Server setup help</summary>
            <p>{cluster.reason}</p>
            <p>
              Run the optional setup in <code>scripts/kind-up.ps1</code>, then
              enable <code>AEGIS_KUBE_ENABLED=true</code> for the backend.
            </p>
            <p>
              The optional server connection uses Kubernetes. Setup steps are in
              the technical guide.
            </p>
          </details>
        </div>
      )}
      <Panel
        title="Apps found on your server"
        description="This list comes from the connected server."
      >
        <DataTable
          rows={cluster.items}
          searchText={(r) => `${r.kind} ${r.name} ${r.namespace}`}
          empty="No connected server apps"
          columns={[
            { label: "Name", render: (r) => <strong>{r.name}</strong> },
            { label: "Kind", render: (r) => r.kind },
            { label: "App group", render: (r) => r.namespace },
            {
              label: "What you can do",
              render: (r) => (r.managed ? "Practice app" : "View only"),
            },
            {
              label: "Server details",
              render: (r) => (
                <code className="status-json">{JSON.stringify(r.status)}</code>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
function Objectives({ metrics }: { metrics: Metrics | undefined }) {
  return (
    <DataTable
      rows={metrics?.coverage || []}
      columns={[
        {
          label: "Application",
          render: (r) => (
            <Link className="text-button" to={`/applications/${r.app_id}`}>
              {r.name}
            </Link>
          ),
        },
        {
          label: "Maximum data age",
          render: (r) => `${r.rpo_target_minutes} min`,
        },
        {
          label: "Age of latest backup",
          render: (r) =>
            r.observed_rpo_minutes == null
              ? "No backup"
              : `${r.observed_rpo_minutes.toFixed(1)} min`,
        },
        {
          label: "Target restore time",
          render: (r) => `${r.rto_target_seconds} s`,
        },
        {
          label: "Actual restore time",
          render: (r) => duration(r.observed_rto_seconds),
        },
        {
          label: "Latest backup",
          render: (r) => date(r.latest_recovery_point),
        },
      ]}
    />
  );
}
function Monitoring({ metrics }: { metrics: Metrics | undefined }) {
  return (
    <>
      <div className="dashboard-grid">
        <Panel
          title="Time to save a backup"
          description="Time taken for each saved backup, in seconds."
        >
          <BackupChart metrics={metrics} />
        </Panel>
        <Panel
          title="Time to restore"
          description="Actual results from completed restores and restarts."
        >
          <RecoveryChart metrics={metrics} />
        </Panel>
      </div>
      <Panel
        title="Your goals and actual results"
        description="Backup age tells you how recent your saved data is. Restore time measures the task itself, after you confirm it."
      >
        <Objectives metrics={metrics} />
      </Panel>
      <Panel title="Storage and task results">
        <dl className="definition-list">
          <dt>Space used by backups</dt>
          <dd>{bytes(metrics?.storage_bytes || 0)}</dd>
          <dt>Apps with / without a backup</dt>
          <dd>
            {metrics?.protected || 0} /{" "}
            {(metrics?.applications || 0) - (metrics?.protected || 0)}
          </dd>
          <dt>Finished / failed or damaged backups</dt>
          <dd>
            {metrics?.backups || 0} / {metrics?.failed_backups || 0}
          </dd>
          <dt>Success rate for saved backups</dt>
          <dd>
            {metrics?.success_rate == null
              ? "Not measured"
              : `${metrics.success_rate}%`}
          </dd>
          <dt>Prometheus scrape</dt>
          <dd>
            <code>GET /metrics</code> · Bearer token required
          </dd>
        </dl>
      </Panel>
    </>
  );
}
function SystemSettings({
  settings,
  apps,
  act,
  motionSetting,
  setMotionSetting,
}: {
  settings: Settings | undefined;
  apps: Application[];
  act: Act;
  motionSetting: string;
  setMotionSetting: (value: string) => void;
}) {
  const [selection, setSelection] = useState("demo");
  const app = apps.find((a) => a.id === selection) || apps[0];
  return (
    <>
      <div className="dashboard-grid">
        <Panel
          title="Backup settings"
          description="Choose when to save backups and how many to keep."
        >
          <label>
            Application
            <select
              value={app?.id || ""}
              onChange={(e) => setSelection(e.target.value)}
            >
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {app && <Policy key={app.id} app={app} act={act} />}
        </Panel>
        <Panel
          title="Connection settings"
          description="View connection details. Advanced options are for the person who set up this app."
        >
          <label>
            Screen animations
            <select
              value={motionSetting}
              onChange={(e) => setMotionSetting(e.target.value)}
            >
              <option value="system">Follow my device settings</option>
              <option value="reduced">Reduce movement</option>
            </select>
            <small>
              Saved on this device. Background data updates never move the page.
            </small>
          </label>
          <p className="settings-summary">
            {settings?.local_mode
              ? "Your data is stored on this computer."
              : "Connected to your backup service."}{" "}
            {settings?.kubernetes_enabled
              ? "Optional server tools are enabled."
              : "You can save and restore backups without connecting a server."}
          </p>
          <details className="advanced">
            <summary>Advanced connection details</summary>
            {settings ? (
              <dl className="definition-list">
                {Object.entries(settings).map(([key, value]) => (
                  <div className="definition-pair" key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>
                      {Array.isArray(value) ? value.join(", ") : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <Loading />
            )}
          </details>
          <div className="environment-note">
            <Shield size={18} />
            <p>
              Credentials stay in the backend environment. Access codes are kept
              only in this browser session when manually entered.
            </p>
          </div>
          <button
            className="secondary"
            onClick={() => {
              sessionStorage.removeItem("aegis-token");
              location.reload();
            }}
          >
            Reset browser connection
          </button>
        </Panel>
      </div>
    </>
  );
}
function Registration({
  act,
  busy,
  onClose,
  onSaved,
}: {
  act: Act;
  busy: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [kind, setKind] = useState("files");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    void act("/applications", { ...data, kind })
      .then((result) => onSaved((result as Application).id))
      .catch(() => undefined);
  };
  return (
    <Modal title="Add an app" onClose={onClose}>
      <p>
        Give your app a name and choose a folder inside the backup area. We
        create a new folder if needed and keep any existing files.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <label className="full">
          App name
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="e.g. Customer portal"
          />
        </label>
        <label className="full">
          Description
          <input
            name="description"
            maxLength={500}
            placeholder="What does this application protect?"
          />
        </label>
        <label>
          Backup type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="files">Files and folders</option>
            <option value="postgres">PostgreSQL database and files</option>
          </select>
        </label>
        <label>
          Folder to back up
          <input
            name="source"
            placeholder="customer-portal"
            required
            pattern="(?:[a-zA-Z0-9_.]|/|-)+"
          />
        </label>
        {kind === "postgres" && (
          <label className="full">
            Saved database connection name
            <input
              name="db_env"
              required
              pattern="AEGIS_DB_[A-Z0-9_]+"
              placeholder="AEGIS_DB_PORTAL"
            />
            <small>
              Set this variable on the backend. Enter its name, never its
              password or URL.
            </small>
          </label>
        )}
        <p className="form-note full">
          New apps save a backup every hour and keep the latest 10 copies. You
          can change this in backup settings.
        </p>
        <div className="modal-actions full">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            <Plus size={16} />
            Add app
          </button>
        </div>
      </form>
    </Modal>
  );
}
