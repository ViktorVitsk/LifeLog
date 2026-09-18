import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
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

interface Props {
  entries: MergedEntry[];
  days?: number;
}

const EMOTION_COLORS = {
  resentment: "#f43f5e",
  guilt: "#f59e0b",
  shame: "#d946ef",
  fear: "#0ea5e9",
} as const;

/**
 * Gap-model 4-line chart.
 *
 * Only reads OPEN numeric fields (resentment_score, guilt_score, shame_score,
 * fear_score) — zero decryption, so it works even without a KEK.
 * This is the exact contract of the "server knows trends but not content"
 * hybrid model from ARCHITECTURE §6.
 */
export default function GapChart({ entries, days = 30 }: Props) {
  const { locale, t } = useLocale();
  const loc = dateLocale(locale);
  const data = useMemo(() => buildDailySeries(entries, days), [entries, days]);
  const tick = (s: string) => formatDayTick(s, loc);
  const names = {
    resentment: t.resentment,
    guilt: t.guilt,
    shame: t.shame,
    fear: t.fear,
  };

  const hasAny = data.some(
    (d) =>
      d.resentment !== null ||
      d.guilt !== null ||
      d.shame !== null ||
      d.fear !== null,
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-200">{t.gapEmotions}</h3>
        <span className="text-[11px] text-zinc-500">{t.lastDays.replace("{n}", String(days))}</span>
      </div>

      {!hasAny ? (
        <div className="h-64 flex items-center justify-center text-sm text-zinc-500">
          {t.noEmotionYet}
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
              <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
              {(Object.keys(EMOTION_COLORS) as (keyof typeof EMOTION_COLORS)[]).map((k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={EMOTION_COLORS[k]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  name={names[k]}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface DailyPoint {
  day: string;
  resentment: number | null;
  guilt: number | null;
  shame: number | null;
  fear: number | null;
}

function buildDailySeries(entries: MergedEntry[], days: number): DailyPoint[] {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const buckets = new Map<
    string,
    { resentment: number[]; guilt: number[]; shame: number[]; fear: number[] }
  >();

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    buckets.set(dayKey(d), { resentment: [], guilt: [], shame: [], fear: [] });
  }

  for (const e of entries) {
    const ts = new Date(e.timestamp);
    if (ts < start) continue;
    const b = buckets.get(dayKey(ts));
    if (!b) continue;
    if (typeof e.resentment_score === "number") b.resentment.push(e.resentment_score);
    if (typeof e.guilt_score === "number") b.guilt.push(e.guilt_score);
    if (typeof e.shame_score === "number") b.shame.push(e.shame_score);
    if (typeof e.fear_score === "number") b.fear.push(e.fear_score);
  }

  return [...buckets.entries()].map(([day, b]) => ({
    day,
    resentment: b.resentment.length ? avg(b.resentment) : null,
    guilt: b.guilt.length ? avg(b.guilt) : null,
    shame: b.shame.length ? avg(b.shame) : null,
    fear: b.fear.length ? avg(b.fear) : null,
  }));
}

function avg(xs: number[]) {
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
}

function dayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayTick(s: string, loc: string) {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(loc, { month: "short", day: "numeric" });
}
