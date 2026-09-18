import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { useDecryptedEntries } from "../../hooks/useDecryptedEntries";
import { dateLocale } from "../../i18n/locale";

interface GratitudePayload {
  v?: number;
  items?: string[];
}

function extractItems(raw: GratitudePayload | undefined): string[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export default function GratitudeLog({
  entries,
  limit = 20,
}: {
  entries: MergedEntry[];
  limit?: number;
}) {
  const { kek } = useAuth();
  const { locale, t } = useLocale();
  const loc = dateLocale(locale);

  const items = useMemo(
    () => entries.filter((e) => e.entry_type === "GRATITUDE").slice(0, limit),
    [entries, limit],
  );

  const { data, errors, pending } = useDecryptedEntries<GratitudePayload>(items, kek);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">{t.gratitudeLog}</h3>
        <span className="text-[11px] text-zinc-500">
          {t.decryptedLocal.replace("{n}", String(limit))}
        </span>
      </div>

      {!kek ? (
        <div className="text-sm text-zinc-500 py-6 text-center">{t.unlockRequired}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">{t.noGratitude}</div>
      ) : pending && Object.keys(data).length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">{t.decrypting}</div>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => {
            const p = data[e.id];
            const err = errors[e.id];
            const lines = extractItems(p);
            return (
              <li key={e.id}>
                <div className="text-[11px] text-zinc-500 tabular-nums">
                  {formatTs(e.timestamp, loc)}
                </div>
                {err ? (
                  <div className="text-xs text-rose-300 mt-1">
                    {t.decryptFailed}: {err}
                  </div>
                ) : lines.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {lines.map((it, i) => (
                      <li key={i} className="text-sm text-zinc-200">
                        <span className="text-zinc-500 mr-2">·</span>
                        {it}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-zinc-500 mt-1">
                    {pending ? "…" : t.emptyCorrupt}
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

function formatTs(ts: string, loc: string) {
  const d = new Date(ts);
  return d.toLocaleString(loc, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
