import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { useDecryptedEntries } from "../../hooks/useDecryptedEntries";

interface GratitudePayload {
  v?: number;
  items?: string[];
}

/**
 * Gratitude log — decrypts each recent gratitude entry eagerly so the user
 * can scan them as a list of items. Capped so we never decrypt hundreds of
 * entries on mount; the user can raise this limit later.
 */
export default function GratitudeLog({
  entries,
  limit = 20,
}: {
  entries: MergedEntry[];
  limit?: number;
}) {
  const { kek } = useAuth();

  const items = useMemo(
    () => entries.filter((e) => e.entry_type === "GRATITUDE").slice(0, limit),
    [entries, limit],
  );

  const { data, pending } = useDecryptedEntries<GratitudePayload>(items, kek);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">Gratitude log</h3>
        <span className="text-[11px] text-zinc-500">
          decrypted in your browser · last {limit}
        </span>
      </div>

      {!kek ? (
        <div className="text-sm text-zinc-500 py-6 text-center">
          Unlock required to decrypt gratitude entries.
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">
          No gratitude entries yet.
        </div>
      ) : pending && Object.keys(data).length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">Decrypting…</div>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => {
            const p = data[e.id];
            return (
              <li key={e.id}>
                <div className="text-[11px] text-zinc-500 tabular-nums">
                  {formatTs(e.timestamp)}
                </div>
                {p?.items && p.items.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {p.items.map((it, i) => (
                      <li key={i} className="text-sm text-zinc-200">
                        <span className="text-zinc-500 mr-2">·</span>
                        {it}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-zinc-500">(empty)</div>
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
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
