import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { api, isNetworkError } from "../lib/api";

const PERIODS = [
  { id: "7d" as const, label: "7d" },
  { id: "30d" as const, label: "30d" },
  { id: "90d" as const, label: "90d" },
  { id: "1y" as const, label: "1y" },
];

const TREND_OPTIONS = [
  { value: "mood_score", label: "Mood" },
  { value: "energy_score", label: "Energy" },
  { value: "anxiety_score", label: "Anxiety" },
  { value: "sleep_hours", label: "Sleep (h)" },
  { value: "sleep_quality", label: "Sleep quality" },
  { value: "weight_kg", label: "Weight (kg)" },
  { value: "body_fat_pct", label: "Body fat %" },
  { value: "focus_score", label: "Focus" },
  { value: "stress_score", label: "Stress" },
];

const CORR_X = [
  { value: "sleep_quality", label: "Sleep quality" },
  { value: "sleep_hours", label: "Sleep hours" },
  { value: "energy_score", label: "Energy" },
];
const CORR_Y = [
  { value: "mood_score", label: "Mood" },
  { value: "anxiety_score", label: "Anxiety" },
  { value: "stress_score", label: "Stress" },
];

export default function AnalyticsPage() {
  const { token } = useAuth();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("30d");
  const [metric, setMetric] = useState("mood_score");
  const [corrX, setCorrX] = useState("sleep_quality");
  const [corrY, setCorrY] = useState("mood_score");

  const trendsQuery = useQuery({
    queryKey: ["analytics", "trends", token, period, metric],
    enabled: Boolean(token),
    queryFn: () => api.getTrends(token!, { metric, period }),
    retry: (n, e) => !isNetworkError(e) && n < 1,
  });

  const corrQuery = useQuery({
    queryKey: ["analytics", "corr", token, period, corrX, corrY],
    enabled: Boolean(token),
    queryFn: () => api.getCorrelations(token!, { x: corrX, y: corrY, period }),
    retry: (n, e) => !isNetworkError(e) && n < 1,
  });

  const trendChartData = useMemo(
    () =>
      (trendsQuery.data ?? []).map((p) => ({
        ...p,
        tick: p.day.slice(5),
      })),
    [trendsQuery.data],
  );

  const scatterData = useMemo(() => corrQuery.data ?? [], [corrQuery.data]);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Server-side aggregates on open metrics only — no ciphertext is read.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Period</span>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={`px-2 py-1 rounded text-xs ${
              period === p.id ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-200">Trend</h2>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="text-sm rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          >
            {TREND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {trendsQuery.isError && (
          <p className="text-xs text-rose-400">{(trendsQuery.error as Error).message}</p>
        )}
        {trendsQuery.isLoading ? (
          <div className="h-56 flex items-center justify-center text-sm text-zinc-500">Loading…</div>
        ) : trendChartData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-zinc-500">
            No points in this range for the selected metric.
          </div>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="tick" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [v.toFixed(2), metric]}
                  labelFormatter={(_label, payload) =>
                    payload?.[0]?.payload?.day != null ? String(payload[0].payload.day) : ""
                  }
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  name={metric}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">Correlation (same UTC day)</h2>
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <select
            value={corrX}
            onChange={(e) => setCorrX(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          >
            {CORR_X.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-zinc-500">vs</span>
          <select
            value={corrY}
            onChange={(e) => setCorrY(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          >
            {CORR_Y.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {corrQuery.isError && (
          <p className="text-xs text-rose-400">{(corrQuery.error as Error).message}</p>
        )}
        {corrQuery.isLoading ? (
          <div className="h-64 flex items-center justify-center text-sm text-zinc-500">Loading…</div>
        ) : scatterData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-zinc-500">
            Need overlapping days with both metrics logged.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis type="number" dataKey="x" name={corrX} stroke="#71717a" fontSize={11} />
                <YAxis type="number" dataKey="y" name={corrY} stroke="#71717a" fontSize={11} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(v: number, name: string) => [v.toFixed(2), name]}
                  labelFormatter={(_label, p) =>
                    p?.[0]?.payload?.day != null ? String(p[0].payload.day) : ""
                  }
                />
                <Scatter name="days" data={scatterData} fill="#a78bfa" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
