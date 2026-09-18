import { useMemo } from "react";
import type { MergedEntry } from "../../hooks/useEntries";
import { useLocale } from "../../context/LocaleContext";
import { dateLocale } from "../../i18n/locale";

type EmotionKey = "resentment" | "guilt" | "shame" | "fear";

const EMOTION_META: {
  key: EmotionKey;
  field: keyof MergedEntry;
  color: string;
}[] = [
  { key: "resentment", field: "resentment_score", color: "text-rose-300" },
  { key: "guilt", field: "guilt_score", color: "text-amber-300" },
  { key: "shame", field: "shame_score", color: "text-fuchsia-300" },
  { key: "fear", field: "fear_score", color: "text-sky-300" },
];

export default function PatternInsights({
  entries,
  days = 30,
}: {
  entries: MergedEntry[];
  days?: number;
}) {
  const { locale, t } = useLocale();
  const loc = dateLocale(locale);
  const labels = {
    resentment: t.resentment,
    guilt: t.guilt,
    shame: t.shame,
    fear: t.fear,
  };
  const stats = useMemo(() => computeStats(entries, days, labels), [entries, days, labels.resentment, labels.guilt, labels.shame, labels.fear]);
  const any = stats.some((s) => s.count > 0);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">{t.patternInsights}</h3>
        <span className="text-[11px] text-zinc-500">{t.lastDays.replace("{n}", String(days))}</span>
      </div>

      {!any ? (
        <div className="text-sm text-zinc-500 py-4 text-center">{t.noPatterns}</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {stats.map((s) => (
            <div
              key={s.key}
              className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm"
            >
              <div className={`text-xs uppercase tracking-wide ${s.color}`}>{s.label}</div>
              {s.count === 0 ? (
                <div className="text-zinc-500 text-xs mt-1">{t.noEntries}</div>
              ) : (
                <>
                  <div className="mt-1 text-zinc-200">
                    {t.avgEntries
                      .replace("{avg}", s.avg.toFixed(1))
                      .replace("{n}", String(s.count))}
                  </div>
                  {s.peak && (
                    <div className="text-xs text-zinc-400 mt-0.5">
                      {t.peakOn
                        .replace("{score}", String(s.peak.score))
                        .replace("{date}", formatDay(s.peak.date, loc))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Stat {
  key: EmotionKey;
  label: string;
  color: string;
  count: number;
  avg: number;
  peak: { date: string; score: number } | null;
}

function computeStats(
  entries: MergedEntry[],
  days: number,
  labels: Record<EmotionKey, string>,
): Stat[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  return EMOTION_META.map(({ key, field, color }) => {
    let sum = 0;
    let count = 0;
    let peak: Stat["peak"] = null;
    for (const e of entries) {
      const v = e[field] as unknown;
      if (typeof v !== "number") continue;
      if (new Date(e.timestamp) < cutoff) continue;
      sum += v;
      count += 1;
      if (!peak || v > peak.score) peak = { date: e.timestamp, score: v };
    }
    return {
      key,
      label: labels[key],
      color,
      count,
      avg: count > 0 ? sum / count : 0,
      peak,
    };
  });
}

function formatDay(ts: string, loc: string) {
  const d = new Date(ts);
  return d.toLocaleDateString(loc, { month: "short", day: "numeric" });
}
