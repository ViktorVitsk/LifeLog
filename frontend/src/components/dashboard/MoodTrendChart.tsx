import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MergedEntry } from "../../hooks/useEntries";

interface Props {
  entries: MergedEntry[];
  days?: number;
}

/**
 * Builds one point per day for the last `days` days. For each day we take
 * the average of mood / energy / anxiety across all entries that day.
 * Days without data render as gaps (null → recharts connectNulls=false).
 */
export default function MoodTrendChart({ entries, days = 30 }: Props) {
  const data = useMemo(() => buildDailySeries(entries, days), [entries, days]);

  const hasAny = data.some((d) => d.mood !== null || d.energy !== null || d.anxiety !== null);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-200">Mood / Energy / Anxiety</h3>
        <span className="text-[11px] text-zinc-500">last {days} days (daily avg)</span>
      </div>

      {!hasAny ? (
        <div className="h-64 flex items-center justify-center text-sm text-zinc-500">
          No data yet — submit your first check-in.
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="day"
                stroke="#71717a"
                fontSize={11}
                tickFormatter={formatDayTick}
              />
              <YAxis stroke="#71717a" fontSize={11} domain={[0, 10]} />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={formatDayTick}
              />
              <Line
                type="monotone"
                dataKey="mood"
                stroke="#6366f1"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name="mood"
              />
              <Line
                type="monotone"
                dataKey="energy"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name="energy"
              />
              <Line
                type="monotone"
                dataKey="anxiety"
                stroke="#f43f5e"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name="anxiety"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface DailyPoint {
  day: string;
  mood: number | null;
  energy: number | null;
  anxiety: number | null;
}

function buildDailySeries(entries: MergedEntry[], days: number): DailyPoint[] {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const buckets = new Map<
    string,
    { mood: number[]; energy: number[]; anxiety: number[] }
  >();

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    buckets.set(dayKey(d), { mood: [], energy: [], anxiety: [] });
  }

  for (const e of entries) {
    const ts = new Date(e.timestamp);
    if (ts < start) continue;
    const k = dayKey(ts);
    const b = buckets.get(k);
    if (!b) continue;
    if (typeof e.mood_score === "number") b.mood.push(e.mood_score);
    if (typeof e.energy_score === "number") b.energy.push(e.energy_score);
    if (typeof e.anxiety_score === "number") b.anxiety.push(e.anxiety_score);
  }

  return [...buckets.entries()].map(([day, b]) => ({
    day,
    mood: b.mood.length ? avg(b.mood) : null,
    energy: b.energy.length ? avg(b.energy) : null,
    anxiety: b.anxiety.length ? avg(b.anxiety) : null,
  }));
}

function avg(xs: number[]) {
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
}

/**
 * Local-calendar day key ("YYYY-MM-DD") — NOT UTC.
 *
 * Bug we're avoiding: `toISOString()` converts to UTC first, so in any
 * timezone east of UTC local midnight becomes "yesterday" in the key.
 * An entry created locally then lands in a bucket that was never inserted,
 * and the chart renders as "No data yet" even though data exists.
 */
function dayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayTick(s: string) {
  // Parse as local midnight so the tick label reflects the local calendar day.
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
