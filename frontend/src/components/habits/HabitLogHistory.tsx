import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { useDecryptedEntries } from "../../hooks/useDecryptedEntries";

interface HabitPayload {
  v?: number;
  notes?: string;
}

/**
 * Recent HABIT_LOG rows for the selected habit — completion + value are open;
 * optional notes decrypt on expand.
 */
export default function HabitLogHistory({
  entries,
  habitId,
  limit = 25,
}: {
  entries: MergedEntry[];
  habitId: string;
  limit?: number;
}) {
  const { kek } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            e.entry_type === "HABIT_LOG" &&
            e.habit_id != null &&
            String(e.habit_id) === String(habitId),
        )
        .slice(0, limit),
    [entries, habitId, limit],
  );

  const target = useMemo(
    () => (openId ? rows.filter((e) => e.id === openId) : []),
    [openId, rows],
  );
  const { data, errors, pending } = useDecryptedEntries<HabitPayload>(target, kek);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-medium text-zinc-200 mb-2">Habit log</h3>
      <p className="text-[11px] text-zinc-500 mb-2">
        Done / value are open fields; encrypted notes expand on demand.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No logs for this habit yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800 text-sm">
          {rows.map((e) => {
            const isOpen = openId === e.id;
            const p = data[e.id];
            const err = errors[e.id];
            return (
              <li key={e.id} className="py-2">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : e.id)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="text-[11px] text-zinc-500 w-32 shrink-0 tabular-nums">
                    {formatTs(e.timestamp)}
                  </span>
                  <span className="text-xs text-zinc-300">
                    {(e.habit_completed as unknown) === true ||
                    (e.habit_completed as unknown) === 1 ? (
                      <span className="text-emerald-400">done</span>
                    ) : (e.habit_completed as unknown) === false ||
                      (e.habit_completed as unknown) === 0 ? (
                      <span className="text-zinc-500">not done</span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                    {typeof e.habit_value === "number" && (
                      <span className="ml-2 font-mono">· {e.habit_value}</span>
                    )}
                  </span>
                  <span className="ml-auto text-[11px] text-zinc-500">{isOpen ? "hide" : "notes"}</span>
                </button>
                {isOpen && (
                  <div className="mt-2 pl-32 pr-1 text-xs">
                    {!kek ? (
                      <div className="text-zinc-500">Unlock required to decrypt.</div>
                    ) : pending && !p && !err ? (
                      <div className="text-zinc-500">Decrypting…</div>
                    ) : err ? (
                      <div className="text-rose-300">{err}</div>
                    ) : p?.notes ? (
                      <div className="text-zinc-200 whitespace-pre-wrap">{p.notes}</div>
                    ) : (
                      <div className="text-zinc-500">(no notes)</div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatTs(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
