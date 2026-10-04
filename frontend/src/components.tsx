import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Database,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { date, duration } from "./api";
import { friendly } from "./language";
import type { Job } from "./types";

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${["completed", "healthy", "connected"].includes(status) ? "positive" : ["failed", "corrupted", "unhealthy"].includes(status) ? "negative" : ["running", "queued"].includes(status) ? "working" : "neutral"}`}
    >
      <i />
      {friendly(status)}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Database size={28} />
      <h3>{title}</h3>
      <p>
        {children || "Saved results will appear here when you get started."}
      </p>
    </div>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const dismiss = () => {
    if (closing.current) return;
    const dialog = ref.current;
    if (
      !dialog ||
      document.documentElement.dataset.motion === "reduced" ||
      !dialog.animate
    ) {
      onClose();
      return;
    }
    closing.current = true;
    const animation = dialog.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.98)" },
      ],
      { duration: 120, easing: "ease-out", fill: "forwards" },
    );
    animation.finished.then(onClose, onClose);
  };
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const animation =
      document.documentElement.dataset.motion !== "reduced" && dialog.animate
        ? dialog.animate(
            [
              { opacity: 0, transform: "translateY(8px) scale(0.98)" },
              { opacity: 1, transform: "translateY(0px) scale(1)" },
            ],
            { duration: 200, easing: "cubic-bezier(0.23,1,0.32,1)" },
          )
        : undefined;
    return () => {
      animation?.cancel();
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            dismiss();
        }
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={dismiss}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function DataTable<T>({
  rows,
  columns,
  empty = "Nothing here yet",
  searchText,
}: {
  rows: T[];
  columns: { label: string; render: (row: T) => ReactNode }[];
  empty?: string;
  searchText?: (row: T) => string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [reverse, setReverse] = useState(false);
  const filtered = rows.filter(
    (row) =>
      !searchText ||
      searchText(row).toLowerCase().includes(search.toLowerCase()),
  );
  const sorted = reverse ? [...filtered].reverse() : filtered;
  const pages = Math.max(1, Math.ceil(sorted.length / 8));
  const current = Math.min(page, pages - 1);
  return (
    <>
      <div className="table-tools">
        <label className="input-search">
          <Search size={16} />
          <input
            aria-label="Filter records"
            placeholder="Find in this list…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <button className="subtle" onClick={() => setReverse(!reverse)}>
          {reverse ? <ArrowUp size={15} /> : <ArrowDown size={15} />}Reverse
          order
        </button>
      </div>
      {sorted.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.label}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(current * 8, current * 8 + 8).map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.label}>{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={empty} />
      )}
      <div className="pagination">
        <span>
          {filtered.length} records · Page {current + 1} of {pages}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Next page"
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </>
  );
}
export function Jobs({
  jobs,
  cancel,
}: {
  jobs: Job[];
  cancel?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Job | null>(null);
  const liveSelected = selected
    ? jobs.find((j) => j.id === selected.id) || selected
    : null;
  return (
    <>
      <DataTable
        rows={jobs}
        searchText={(r) =>
          `${r.kind} ${r.status} ${r.detail.scenario || ""} ${r.stage}`
        }
        empty="No tasks yet"
        columns={[
          {
            label: "Task",
            render: (r) => (
              <button className="text-button" onClick={() => setSelected(r)}>
                {friendly(
                  r.kind === "simulation"
                    ? r.detail.scenario || r.kind
                    : r.kind,
                )}
                <small>{r.id.slice(0, 10)}</small>
              </button>
            ),
          },
          { label: "Status", render: (r) => <Badge status={r.status} /> },
          {
            label: "Stage",
            render: (r) => (
              <div className="stage-cell">
                {friendly(r.stage)}
                {r.status === "running" && (
                  <progress value={r.progress} max={100} />
                )}
              </div>
            ),
          },
          {
            label: "Started",
            render: (r) => date(r.started_at || r.created_at),
          },
          { label: "Duration", render: (r) => duration(r.duration_seconds) },
          {
            label: "Action",
            render: (r) =>
              r.status === "queued" && cancel ? (
                <button className="subtle" onClick={() => cancel(r.id)}>
                  Cancel
                </button>
              ) : (
                <button className="subtle" onClick={() => setSelected(r)}>
                  View details
                </button>
              ),
          },
        ]}
      />
      {liveSelected && (
        <Modal title="What happened" onClose={() => setSelected(null)}>
          <div className="detail-line">
            <code>{liveSelected.id}</code>
            <Badge status={liveSelected.status} />
          </div>
          {liveSelected.error && (
            <p className="error-box">{liveSelected.error}</p>
          )}
          <ol className="timeline">
            {liveSelected.detail.timeline?.map((s, i) => (
              <li key={i}>
                <span>{friendly(s.stage)}</span>
                <small>{date(s.at)}</small>
              </li>
            ))}
            {liveSelected.finished_at && (
              <li>
                <span>{friendly(liveSelected.stage)}</span>
                <small>{date(liveSelected.finished_at)}</small>
              </li>
            )}
          </ol>
          {liveSelected.detail.safety_backup_id && (
            <p>
              Safety backup: <code>{liveSelected.detail.safety_backup_id}</code>
            </p>
          )}
          {liveSelected.detail.result &&
            Object.keys(liveSelected.detail.result).length > 0 && (
              <>
                <h3>Results</h3>
                <dl className="definition-list">
                  {Object.entries(liveSelected.detail.result).map(
                    ([key, value]) => (
                      <div className="definition-pair" key={key}>
                        <dt>
                          {(
                            {
                              dataset_matches:
                                "Restored notes match the original",
                              records_before: "Notes before the exercise",
                              records_after_loss: "Notes after deletion",
                              records_restored: "Notes restored",
                              corruption_detected: "Damage detected",
                              valid_original_preserved:
                                "Original backup is safe",
                              kubernetes: "Server setup restored",
                              database: "Database",
                              restored_files: "Backup parts restored",
                              mechanism: "Recovery method",
                            } as Record<string, string>
                          )[key] || friendly(key)}
                        </dt>
                        <dd>
                          {typeof value === "boolean"
                            ? value
                              ? "Yes"
                              : "No"
                            : friendly(String(value))}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
                <details className="advanced">
                  <summary>Technical details</summary>
                  <pre>
                    {JSON.stringify(liveSelected.detail.result, null, 2)}
                  </pre>
                </details>
              </>
            )}
        </Modal>
      )}
    </>
  );
}
export function Loading() {
  return (
    <div className="skeleton-stack" aria-label="Loading data" role="status">
      <LoaderCircle className="spin" />
      <div />
      <div />
      <div />
    </div>
  );
}
