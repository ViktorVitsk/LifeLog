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
import { useLocale } from "../context/LocaleContext";
import { metricLabel } from "../i18n/strings";
import { api } from "../lib/api";

const PERIODS = ["7d", "30d", "90d", "1y"] as const;

const TREND_KEYS = [
  "mood_score",
  "energy_score",
  "anxiety_score",
  "sleep_hours",
  "sleep_quality",
  "weight_kg",
  "body_fat_pct",
  "focus_score",
  "stress_score",
  "session_duration_min",
] as const;

const CORR_X_KEYS = ["sleep_quality", "sleep_hours", "energy_score"] as const;
const CORR_Y_KEYS = ["mood_score", "anxiety_score", "stress_score"] as const;

export default function AnalyticsPage() {
  const { token, userId } = useAuth();
  const { t } = useLocale();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("30d");
  const [metric, setMetric] = useState("mood_score");
  const [corrX, setCorrX] = useState("sleep_quality");
  const [corrY, setCorrY] = useState("mood_score");
  const [lagDays, setLagDays] = useState(0);

  const metricName = metricLabel(t, metric);
  const xName = metricLabel(t, corrX);
  const yName = metricLabel(t, corrY);

  const trendsQuery = useQuery({
    queryKey: ["analytics", "trends", userId, period, metric],
    enabled: Boolean(token && userId),
    queryFn: () => api.getTrends(token!, { metric, period }),
    retry: false,
  });

  const corrQuery = useQuery({
    queryKey: ["analytics", "corr", userId, period, corrX, corrY, lagDays],
    enabled: Boolean(token && userId),
    queryFn: () => api.getCorrelations(token!, { x: corrX, y: corrY, period, lag_days: lagDays }),
    retry: false,
  });

  const trendSeries = trendsQuery.data;
  const trendChartData = useMemo(
    () =>
      (trendSeries?.points ?? []).map((p) => ({
        ...p,
        tick: p.day.slice(5),
      })),
    [trendSeries],
  );

  const scatterData = useMemo(() => corrQuery.data?.points ?? [], [corrQuery.data]);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.analyticsTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.analyticsHint}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">{t.period}</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`px-2 py-1 rounded text-xs ${
              period === p ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-200">{t.trend}</h2>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="text-sm rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          >
            {TREND_KEYS.map((value) => (
              <option key={value} value={value}>
                {metricLabel(t, value)}
              </option>
            ))}
          </select>
        </div>
        {trendSeries && (
          <p className="text-xs text-zinc-500">
            {t.seriesCoverage
              .replace("{n}", String(trendSeries.observations))
              .replace("{days}", String(trendSeries.days_with_data))
              .replace("{period}", String(trendSeries.period_days))
              .replace("{pct}", String(Math.round(trendSeries.coverage * 100)))
              .replace("{agg}", trendSeries.aggregation === "sum" ? t.aggSum : t.aggAvg)}
          </p>
        )}
        {trendsQuery.isError && (
          <p className="text-xs text-rose-400">{(trendsQuery.error as Error).message}</p>
        )}
        {trendsQuery.isLoading ? (
          <div className="h-56 flex items-center justify-center text-sm text-zinc-500">{t.loading}</div>
        ) : trendChartData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-zinc-500">
            {t.noMetricPoints}
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
                  formatter={(v: number) => [v.toFixed(2), metricName]}
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
                  name={metricName}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">{t.correlation}</h2>
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <select
            value={corrX}
            onChange={(e) => setCorrX(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          >
            {CORR_X_KEYS.map((value) => (
              <option key={value} value={value}>
                {metricLabel(t, value)}
              </option>
            ))}
          </select>
          <span className="text-zinc-500">{t.vs}</span>
          <select
            value={corrY}
            onChange={(e) => setCorrY(e.target.value)}
            className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          >
            {CORR_Y_KEYS.map((value) => (
              <option key={value} value={value}>
                {metricLabel(t, value)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            {t.lagDays}
            <select
              value={lagDays}
              onChange={(e) => setLagDays(Number(e.target.value))}
              className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-200"
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
            </select>
          </label>
        </div>
        {corrQuery.data && (
          <p className="text-xs text-zinc-500">
            {t.jointCoverage
              .replace("{n}", String(corrQuery.data.observations))
              .replace("{lag}", String(corrQuery.data.lag_days))}
          </p>
        )}
        {corrQuery.isError && (
          <p className="text-xs text-rose-400">{(corrQuery.error as Error).message}</p>
        )}
        {corrQuery.isLoading ? (
          <div className="h-64 flex items-center justify-center text-sm text-zinc-500">{t.loading}</div>
        ) : scatterData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-zinc-500">
            {corrQuery.data?.insufficient ? t.insufficientJoint : t.needOverlap}
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis type="number" dataKey="x" name={xName} stroke="#71717a" fontSize={11} />
                <YAxis type="number" dataKey="y" name={yName} stroke="#71717a" fontSize={11} />
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
                <Scatter name={t.days} data={scatterData} fill="#a78bfa" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
