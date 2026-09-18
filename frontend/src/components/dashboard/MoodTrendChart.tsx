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
import { useLocale } from "../../context/LocaleContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { dateLocale } from "../../i18n/locale";
import { calendarDayKey, getAccountTimeZone } from "../../lib/dates";

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
  const { locale, t } = useLocale();
  const loc = dateLocale(locale);
  const data = useMemo(() => buildDailySeries(entries, days), [entries, days]);

  const hasAny = data.some((d) => d.mood !== null || d.energy !== null || d.anxiety !== null);
  const tick = (s: string) => formatDayTick(s, loc);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-200">{t.moodEnergyAnxiety}</h3>
        <span className="text-[11px] text-zinc-500">{t.lastDays.replace("{n}", String(days))}</span>
      </div>

      {!hasAny ? (
        <div className="h-64 flex items-center justify-center text-sm text-zinc-500">
          {t.noCheckinYet}
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
                tickFormatter={tick}
              />
              <YAxis stroke="#71717a" fontSize={11} domain={[0, 10]} />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={tick}
              />
              <Line
                type="monotone"
                dataKey="mood"
                stroke="#6366f1"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name={t.mood}
              />
              <Line
                type="monotone"
                dataKey="energy"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name={t.energy}
              />
              <Line
                type="monotone"
                dataKey="anxiety"
                stroke="#f43f5e"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name={t.anxiety}
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
  const zone = getAccountTimeZone();
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const instant = new Date(now.getTime() - i * 24 * 3600_000);
    keys.push(calendarDayKey(instant, zone));
  }
  const uniqueKeys = [...new Set(keys)];

  const buckets = new Map<
    string,
    { mood: number[]; energy: number[]; anxiety: number[] }
  >();
  for (const key of uniqueKeys) {
    buckets.set(key, { mood: [], energy: [], anxiety: [] });
  }

  for (const e of entries) {
    const k = calendarDayKey(e.timestamp, e.event_timezone || zone);
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

function formatDayTick(s: string, loc: string) {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(loc, { month: "short", day: "numeric" });
}
