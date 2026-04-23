import { useMemo } from "react";
import type { MergedEntry } from "../../hooks/useEntries";

type EmotionKey = "resentment" | "guilt" | "shame" | "fear";

const EMOTIONS: {
  key: EmotionKey;
  field: keyof MergedEntry;
  label: string;
  color: string;
}[] = [
  { key: "resentment", field: "resentment_score", label: "Resentment", color: "text-rose-300" },
  { key: "guilt", field: "guilt_score", label: "Guilt", color: "text-amber-300" },
  { key: "shame", field: "shame_score", label: "Shame", color: "text-fuchsia-300" },
  { key: "fear", field: "fear_score", label: "Fear", color: "text-sky-300" },
];

/**
 * Aggregates only OPEN numeric fields over the last `days` days.
 * No decryption, no API call — pure client-side reduction over the already
 * loaded entry stream.
 *
 * Phase 3 scope: per-emotion average + peak (date + score). Richer
 * correlations (day-of-week, cross-field) are deferred to Phase 5.
 */
export default function PatternInsights({
  entries,
  days = 30,
}: {
  entries: MergedEntry[];
  days?: number;
}) {
  const stats = useMemo(() => computeStats(entries, days), [entries, days]);
  const any = stats.some((s) => s.count > 0);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">Pattern insights</h3>
        <span className="text-[11px] text-zinc-500">last {days} days</span>
      </div>

      {!any ? (
        <div className="text-sm text-zinc-500 py-4 text-center">
          Add a few emotional state entries to see patterns.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {stats.map((s) => (
            <div
              key={s.key}
              className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm"
            >
              <div className={`text-xs uppercase tracking-wide ${s.color}`}>{s.label}</div>
              {s.count === 0 ? (
                <div className="text-zinc-500 text-xs mt-1">No entries</div>
              ) : (
                <>
                  <div className="mt-1 text-zinc-200">
                    avg <span className="font-mono tabular-nums">{s.avg.toFixed(1)}</span>
                    <span className="text-zinc-500"> · {s.count} entries</span>
                  </div>
                  {s.peak && (
                    <div className="text-xs text-zinc-400 mt-0.5">
                      peak {s.peak.score} on {formatDay(s.peak.date)}
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

function computeStats(entries: MergedEntry[], days: number): Stat[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  return EMOTIONS.map(({ key, field, label, color }) => {
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
      label,
      color,
      count,
      avg: count > 0 ? sum / count : 0,
      peak,
    };
  });
}

function formatDay(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
