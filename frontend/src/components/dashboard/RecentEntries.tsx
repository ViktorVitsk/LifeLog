import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { dateLocale } from "../../i18n/locale";
import { entryTypeLabel, type TStrings } from "../../i18n/strings";
import { decryptEntry } from "../../lib/crypto";

export default function RecentEntries({ entries }: { entries: MergedEntry[] }) {
  const { t } = useLocale();
  const rows = entries.slice(0, 12);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">{t.recentActivity}</h3>
        <span className="text-[11px] text-zinc-500">{t.recentHint}</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-500">{t.nothingYet}</div>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {rows.map((e) => (
            <RecentRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentRow({ entry: e }: { entry: MergedEntry }) {
  const { kek } = useAuth();
  const { locale, t } = useLocale();
  const loc = dateLocale(locale);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggleDetails() {
    if (!open) {
      setOpen(true);
      if (text !== null || err || !kek) return;
      setBusy(true);
      setErr(null);
      try {
        const raw = await decryptEntry(e.encrypted_content, e.encrypted_dek, kek);
        setText(raw);
      } catch (x) {
        setErr((x as Error).message);
      } finally {
        setBusy(false);
      }
    } else {
      setOpen(false);
    }
  }

  let parsed: Record<string, unknown> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-mono text-zinc-500 w-28 shrink-0">
          {new Date(e.timestamp).toLocaleString(loc, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
          {entryTypeLabel(t, e.entry_type)}
        </span>
        <span className="text-xs text-zinc-400 flex-1 min-w-[120px]">
          {buildScoreSummary(e, t) || (e.tags?.length ? `#${e.tags.join(" #")}` : "—")}
        </span>
        <button
          type="button"
          onClick={() => void toggleDetails()}
          disabled={!kek}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-40"
        >
          {!kek ? t.locked : open ? t.hide : t.details}
        </button>
        <SourceBadge source={e._source} t={t} />
      </div>
      {open && (
        <div className="mt-2 pl-28 text-xs text-zinc-300 space-y-1 border-l border-zinc-800 ml-2">
          {!kek ? (
            <span className="text-zinc-500">{t.unlockToRead}</span>
          ) : busy ? (
            <span className="text-zinc-500">{t.decrypting}</span>
          ) : err ? (
            <span className="text-rose-300">{err}</span>
          ) : parsed ? (
            <DecryptedSummary entryType={e.entry_type} payload={parsed} t={t} />
          ) : text ? (
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-zinc-400">{text}</pre>
          ) : null}
        </div>
      )}
    </li>
  );
}

function DecryptedSummary({
  entryType,
  payload,
  t,
}: {
  entryType: string;
  payload: Record<string, unknown>;
  t: TStrings;
}) {
  if (entryType === "DAILY_CHECKIN") {
    const notes = typeof payload.notes === "string" ? payload.notes : "";
    const tod = typeof payload.time_of_day === "string" ? payload.time_of_day : "";
    const legacy: string[] = [];
    if (typeof payload.focus_score === "number") legacy.push(`${t.focus} ${payload.focus_score}`);
    if (typeof payload.social_battery === "number")
      legacy.push(`${t.social} ${payload.social_battery}`);
    if (typeof payload.stress_score === "number") legacy.push(`${t.stress} ${payload.stress_score}`);
    return (
      <div className="space-y-1">
        {tod && (
          <div className="text-zinc-500">
            {t.timeOfDay}: {tod}
          </div>
        )}
        {legacy.length > 0 && (
          <div className="text-[10px] text-amber-200/80">
            {t.olderCheckins} {legacy.join(" · ")}
          </div>
        )}
        {notes ? (
          <div className="whitespace-pre-wrap text-zinc-200">{notes}</div>
        ) : (
          <div className="text-zinc-500">{t.noNotesCipher}</div>
        )}
      </div>
    );
  }
  if (entryType === "GRATITUDE" && Array.isArray(payload.items)) {
    return (
      <ul>
        {(payload.items as unknown[]).map((it, i) => (
          <li key={i}>· {String(it)}</li>
        ))}
      </ul>
    );
  }
  return (
    <pre className="whitespace-pre-wrap font-mono text-[10px] text-zinc-500 max-h-40 overflow-y-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function SourceBadge({ source, t }: { source: MergedEntry["_source"]; t: TStrings }) {
  if (source === "server") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-200">
        {t.synced}
      </span>
    );
  }
  if (source === "error") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/40 border border-rose-700 text-rose-200">
        {t.retry}
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700 text-amber-200">
      {t.pending}
    </span>
  );
}

function buildScoreSummary(e: MergedEntry, t: TStrings): string {
  const parts: string[] = [];
  if (typeof e.mood_score === "number") parts.push(`${t.mood} ${e.mood_score}`);
  if (typeof e.energy_score === "number") parts.push(`${t.energy} ${e.energy_score}`);
  if (typeof e.anxiety_score === "number") parts.push(`${t.anxiety} ${e.anxiety_score}`);
  if (typeof e.focus_score === "number") parts.push(`${t.focus} ${e.focus_score}`);
  if (typeof e.social_battery_score === "number") parts.push(`${t.social} ${e.social_battery_score}`);
  if (typeof e.stress_score === "number") parts.push(`${t.stress} ${e.stress_score}`);
  if (typeof e.session_duration_min === "number") parts.push(`${e.session_duration_min} ${t.minShort}`);
  if (e.entry_type === "HABIT_LOG") {
    const hc = e.habit_completed as unknown;
    if (hc === true || hc === 1) parts.push(`${t.habits} ✓`);
    else if (hc === false || hc === 0) parts.push(`${t.habits} ✗`);
    if (typeof e.habit_value === "number") parts.push(`${t.value} ${e.habit_value}`);
  }
  if (typeof e.resentment_score === "number") parts.push(`${t.resentment[0]}${e.resentment_score}`);
  if (typeof e.guilt_score === "number") parts.push(`${t.guilt[0]}${e.guilt_score}`);
  if (typeof e.shame_score === "number") parts.push(`${t.shame[0]}${e.shame_score}`);
  if (typeof e.fear_score === "number") parts.push(`${t.fear[0]}${e.fear_score}`);
  return parts.join(" · ");
}
