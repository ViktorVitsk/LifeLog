import { useQuery } from "@tanstack/react-query";
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
import type { ChartSpec } from "../../agent/types";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { useEntries } from "../../hooks/useEntries";
import { metricLabel } from "../../i18n/strings";
import { api } from "../../lib/api";
import HabitHeatmap from "../habits/HabitHeatmap";
import SkillSessionChart from "../skills/SkillSessionChart";

export default function ChartBlock({ spec, compact }: { spec: ChartSpec; compact?: boolean }) {
  const h = compact ? "h-44" : "h-[200px] md:h-56";
  if (spec.kind === "habit_heatmap") return <HeatmapChart spec={spec} />;
  if (spec.kind === "skill_bars") return <SkillChart spec={spec} />;
  if (spec.kind === "scatter") return <ScatterBlock spec={spec} heightClass={h} />;
  return <TrendBlock spec={spec} heightClass={h} />;
}

function TrendBlock({ spec, heightClass }: { spec: ChartSpec; heightClass: string }) {
  const { token } = useAuth();
  const { t } = useLocale();
  const metric = spec.metric ?? "mood_score";
  const period = spec.period ?? "30d";
  const q = useQuery({
    queryKey: ["agent-trend", metric, period],
    enabled: Boolean(token),
    queryFn: () => api.getTrends(token!, { metric, period }),
  });
  const data = (q.data ?? []).map((p) => ({ ...p, tick: p.day.slice(5) }));
  const label = metricLabel(t, metric);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-xs text-zinc-400 mb-1">{spec.title ?? `${t.trend} · ${label}`}</div>
      {q.isError ? (
        <p className="text-xs text-rose-400">{(q.error as Error).message}</p>
      ) : data.length === 0 ? (
        <div className={`${heightClass} flex items-center justify-center text-sm text-zinc-500`}>
          {t.noPoints}
        </div>
      ) : (
        <div className={heightClass}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="tick" stroke="#71717a" fontSize={10} />
              <YAxis stroke="#71717a" fontSize={10} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                formatter={(v: number) => [v, label]}
              />
              <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} name={label} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ScatterBlock({ spec, heightClass }: { spec: ChartSpec; heightClass: string }) {
  const { token } = useAuth();
  const { t } = useLocale();
  const x = spec.x ?? "sleep_quality";
  const y = spec.y ?? "mood_score";
  const period = spec.period ?? "30d";
  const q = useQuery({
    queryKey: ["agent-corr", x, y, period],
    enabled: Boolean(token),
    queryFn: () => api.getCorrelations(token!, { x, y, period }),
  });
  const data = q.data ?? [];
  const xLabel = metricLabel(t, x);
  const yLabel = metricLabel(t, y);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-xs text-zinc-400 mb-1">{spec.title ?? `${xLabel} ${t.vs} ${yLabel}`}</div>
      {data.length === 0 ? (
        <div className={`${heightClass} flex items-center justify-center text-sm text-zinc-500`}>
          {t.needOverlap}
        </div>
      ) : (
        <div className={heightClass}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis type="number" dataKey="x" name={xLabel} stroke="#71717a" fontSize={10} />
              <YAxis type="number" dataKey="y" name={yLabel} stroke="#71717a" fontSize={10} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              />
              <Scatter data={data} fill="#a78bfa" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function HeatmapChart({ spec }: { spec: ChartSpec }) {
  const { t } = useLocale();
  const { entries } = useEntries();
  if (!spec.habit_id) {
    return (
      <div className="rounded-lg border border-zinc-800 p-3 text-sm text-zinc-500">
        {t.heatmapNeedHabit}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <HabitHeatmap entries={entries} habitId={spec.habit_id} weeks={8} />
    </div>
  );
}

function SkillChart({ spec }: { spec: ChartSpec }) {
  const { entries } = useEntries();
  const filtered = spec.skill_id
    ? entries.filter((e) => e.skill_id === spec.skill_id)
    : entries.filter((e) => e.entry_type === "SKILL_SESSION");
  return <SkillSessionChart entries={filtered} days={28} />;
}
