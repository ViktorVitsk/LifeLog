import type { MergedEntry } from "../../hooks/useEntries";

/**
 * Shows metadata-only feed: timestamp, type, open numeric scores, tags.
 * Content stays encrypted — nothing is decrypted here.
 */
export default function RecentEntries({ entries }: { entries: MergedEntry[] }) {
  const rows = entries.slice(0, 10);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">Recent activity</h3>
        <span className="text-[11px] text-zinc-500">metadata only (content stays encrypted)</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-500">Nothing yet.</div>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {rows.map((e) => (
            <li key={e.id} className="py-2 flex items-center gap-3">
              <span className="text-[11px] font-mono text-zinc-500 w-28 shrink-0">
                {new Date(e.timestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                {e.entry_type}
              </span>
              <span className="text-xs text-zinc-400 flex-1 truncate">
                {buildScoreSummary(e) || (e.tags?.length ? `#${e.tags.join(" #")}` : "—")}
              </span>
              <SourceBadge source={e._source} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: MergedEntry["_source"] }) {
  if (source === "server") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-200">
        synced
      </span>
    );
  }
  if (source === "error") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/40 border border-rose-700 text-rose-200">
        retry
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700 text-amber-200">
      pending
    </span>
  );
}

function buildScoreSummary(e: MergedEntry): string {
  const parts: string[] = [];
  if (typeof e.mood_score === "number") parts.push(`mood ${e.mood_score}`);
  if (typeof e.energy_score === "number") parts.push(`energy ${e.energy_score}`);
  if (typeof e.anxiety_score === "number") parts.push(`anxiety ${e.anxiety_score}`);
  return parts.join(" · ");
}
