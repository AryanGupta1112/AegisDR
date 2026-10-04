import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { date } from "./api";
import { Empty } from "./components";
import type { Metrics } from "./types";
export function BackupChart({ metrics }: { metrics: Metrics | undefined }) {
  const series = metrics?.backup_series || [];
  if (!series.length)
    return (
      <Empty title="A clean slate for your history">
        Create a backup to start measuring performance. Historical values are
        never generated.
      </Empty>
    );
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={series.map((r, i) => ({ ...r, index: i + 1 }))}
          margin={{ top: 20, right: 20, left: 0, bottom: 18 }}
        >
          <defs>
            <linearGradient id="backup-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="index"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            label={{
              value: "Backup number",
              position: "insideBottomRight",
              offset: -3,
              fill: "var(--muted)",
              fontSize: 11,
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={46}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            unit=" s"
          />
          <Tooltip
            contentStyle={{
              background: "var(--panel-solid)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              color: "var(--text)",
            }}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.at ? date(payload[0].payload.at) : ""
            }
          />
          <Area
            type="monotone"
            dataKey="duration"
            name="Duration (seconds)"
            stroke="var(--chart)"
            strokeWidth={2.5}
            fill="url(#backup-fill)"
            dot={{ r: 3, fill: "var(--chart)" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RecoveryChart({ metrics }: { metrics: Metrics | undefined }) {
  return (
    <>
      {metrics?.recovery_series.length ? (
        <div className="chart">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={metrics.recovery_series.map((r, i) => ({
                ...r,
                index: i + 1,
              }))}
            >
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="index" stroke="var(--muted)" />
              <YAxis stroke="var(--muted)" />
              <Tooltip
                contentStyle={{
                  background: "var(--panel-solid)",
                  color: "var(--text)",
                  border: "1px solid var(--line)",
                }}
              />
              <Bar
                dataKey="duration"
                name="Time to restore (s)"
                fill="var(--chart)"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty title="No restores yet">
          After your first restore, you will see how long it took.
        </Empty>
      )}
    </>
  );
}
