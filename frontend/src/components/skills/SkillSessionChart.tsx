import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocale } from "../../context/LocaleContext";
import { dateLocale } from "../../i18n/locale";
import type { EntryRead } from "../../lib/api";
import { calendarDayKey, getAccountTimeZone } from "../../lib/dates";

interface Props {
  entries: EntryRead[];
  days?: number;
}

/**
 * Total practice minutes per local calendar day (sum of session_duration_min).
 * Uses only open fields — no decryption.
 */
export default function SkillSessionChart({ entries, days = 56 }: Props) {
  const { locale, t } = useLocale();
  const loc = dateLocale(locale);
  const data = useMemo(() => buildDailyBars(entries, days), [entries, days]);
  const hasAny = data.some((d) => d.minutes > 0);
  const tick = (s: string) => formatDayTick(s, loc);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-200">{t.practiceTime}</h3>
        <span className="text-[11px] text-zinc-500">{t.minutesPerDay.replace("{n}", String(days))}</span>
      </div>
      {!hasAny ? (
        <div className="h-48 flex items-center justify-center text-sm text-zinc-500">
          {t.noSessionsRange}
        </div>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="day"
                stroke="#71717a"
                fontSize={10}
                interval="preserveStartEnd"
                tickFormatter={tick}
              />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={tick}
              />
              <Bar dataKey="minutes" fill="#6366f1" radius={[2, 2, 0, 0]} name={t.minShort} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface BarPoint {
  day: string;
  minutes: number;
}

function buildDailyBars(entries: EntryRead[], days: number): BarPoint[] {
  const now = new Date();
  const zone = getAccountTimeZone();
  const sums = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const instant = new Date(now.getTime() - i * 24 * 3600_000);
    sums.set(calendarDayKey(instant, zone), 0);
  }

  for (const e of entries) {
    if (e.entry_type !== "SKILL_SESSION") continue;
    const m = e.session_duration_min;
    if (typeof m !== "number" || m <= 0) continue;
    const k = calendarDayKey(e.timestamp, e.event_timezone || zone);
    if (!sums.has(k)) continue;
    sums.set(k, (sums.get(k) ?? 0) + m);
  }

  return [...sums.entries()].map(([day, minutes]) => ({ day, minutes }));
}

function formatDayTick(s: string, loc: string) {
  const [y, mo, d] = s.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString(loc, { month: "short", day: "numeric" });
}
