import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useEntries, type MergedEntry } from "../hooks/useEntries";
import { dateLocale } from "../i18n/locale";
import { entryTypeLabel } from "../i18n/strings";
import { decryptEntry } from "../lib/crypto";

const JOURNAL_TYPES = new Set(["THOUGHT", "GRATITUDE", "EMOTIONAL_STATE"]);

export default function JournalPage() {
  const { kek } = useAuth();
  const { locale, t } = useLocale();
  const loc = dateLocale(locale);
  const { entries, isLoading } = useEntries();
  const [tagFilter, setTagFilter] = useState("");
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = tagFilter.trim().toLowerCase();
    return entries.filter((e) => {
      if (!JOURNAL_TYPES.has(e.entry_type)) return false;
      if (!q) return true;
      return (e.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
    });
  }, [entries, tagFilter]);

  async function openEntry(e: MergedEntry) {
    if (!kek) {
      setPreview({
        title: t.unlockRequired,
        body: t.unlockToDecrypt,
      });
      return;
    }
    setBusyId(e.id);
    try {
      const raw = await decryptEntry(e.encrypted_content, e.encrypted_dek, kek);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setPreview({
        title: `${entryTypeLabel(t, e.entry_type)} · ${new Date(e.timestamp).toLocaleString(loc)}`,
        body: JSON.stringify(parsed, null, 2),
      });
    } catch {
      setPreview({
        title: t.decryptFailed,
        body: t.decryptFailedBody,
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.timelineTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.timelineHint}</p>
      </div>

      <div>
        <label className="text-sm text-zinc-300">{t.tagContains}</label>
        <input
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder={t.tagPlaceholder}
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm"
        />
      </div>

      {isLoading && <p className="text-sm text-zinc-500">{t.loadingEntries}</p>}

      <ul className="space-y-2">
        {filtered.map((e) => (
          <li
            key={e.id}
            className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
          >
            <div>
              <div className="text-sm text-zinc-200">{entryTypeLabel(t, e.entry_type)}</div>
              <div className="text-xs text-zinc-500">
                {new Date(e.timestamp).toLocaleString(loc)}
                {e.tags?.length ? ` · ${e.tags.join(", ")}` : ""}
              </div>
            </div>
            <button
              type="button"
              disabled={busyId === e.id}
              onClick={() => void openEntry(e)}
              className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              {busyId === e.id ? "…" : t.decrypt}
            </button>
          </li>
        ))}
      </ul>

      {filtered.length === 0 && !isLoading && (
        <p className="text-sm text-zinc-500">{t.noJournal}</p>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <button
            type="button"
            aria-label={t.close}
            className="absolute inset-0 cursor-default bg-transparent"
            onClick={() => setPreview(null)}
          />
          <div
            className="relative z-10 max-w-lg w-full max-h-[80vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-left"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex justify-between items-start gap-2 mb-2">
              <h2 className="text-sm font-medium text-zinc-200">{preview.title}</h2>
              <button
                type="button"
                className="text-zinc-400 hover:text-white text-xs"
                onClick={() => setPreview(null)}
              >
                {t.close}
              </button>
            </div>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono">{preview.body}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
