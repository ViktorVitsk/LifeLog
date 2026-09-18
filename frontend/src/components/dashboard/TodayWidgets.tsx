import { useMemo } from "react";
import type { MergedEntry } from "../../hooks/useEntries";
import { useLocale } from "../../context/LocaleContext";
import { entryTypeLabel } from "../../i18n/strings";

interface Props {
  entries: MergedEntry[];
}

export default function TodayWidgets({ entries }: Props) {
  const { t } = useLocale();
  const { mood, energy, anxiety, countToday, typeCounts } = useMemo(
    () => computeTodaySummary(entries),
    [entries],
  );

  const hint =
    countToday > 0
      ? [...typeCounts.entries()]
          .map(([k, v]) => `${v}× ${entryTypeLabel(t, k)}`)
          .join(" · ")
      : "—";

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
      <Stat label={t.todayMood} value={fmt(mood)} tone="indigo" />
      <Stat label={t.energy} value={fmt(energy)} tone="emerald" />
      <Stat label={t.anxiety} value={fmt(anxiety)} tone="rose" />
      <Stat label={t.entriesToday} value={String(countToday)} tone="zinc" hint={hint} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "indigo" | "emerald" | "rose" | "zinc";
}) {
  const toneCls = {
    indigo: "text-indigo-300",
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    zinc: "text-zinc-200",
  }[tone];
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
      {hint && <div className="text-[11px] text-zinc-500 mt-1 truncate">{hint}</div>}
    </div>
  );
}

function fmt(v: number | null) {
  return v === null ? "—" : v.toFixed(1);
}

function computeTodaySummary(entries: MergedEntry[]) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const mood: number[] = [];
  const energy: number[] = [];
  const anxiety: number[] = [];
  const typeCounts = new Map<string, number>();
  let countToday = 0;

  for (const e of entries) {
    if (new Date(e.timestamp) < startOfDay) continue;
    countToday += 1;
    typeCounts.set(e.entry_type, (typeCounts.get(e.entry_type) ?? 0) + 1);
    if (typeof e.mood_score === "number") mood.push(e.mood_score);
    if (typeof e.energy_score === "number") energy.push(e.energy_score);
    if (typeof e.anxiety_score === "number") anxiety.push(e.anxiety_score);
  }

  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;

  return {
    mood: avg(mood),
    energy: avg(energy),
    anxiety: avg(anxiety),
    countToday,
    typeCounts,
  };
}
