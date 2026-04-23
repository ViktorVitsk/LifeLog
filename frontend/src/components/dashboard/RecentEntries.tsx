import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { decryptEntry } from "../../lib/crypto";

/**
 * Metadata-first feed with optional **Details** expand — decrypts one row
 * client-side so you can read encrypted notes / legacy fields. Open scores
 * (mood, focus, …) stay visible without expanding.
 */
export default function RecentEntries({ entries }: { entries: MergedEntry[] }) {
  const rows = entries.slice(0, 12);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">Recent activity</h3>
        <span className="text-[11px] text-zinc-500">open scores + optional decrypt</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-500">Nothing yet.</div>
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
          {new Date(e.timestamp).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">{e.entry_type}</span>
        <span className="text-xs text-zinc-400 flex-1 min-w-[120px]">
          {buildScoreSummary(e) || (e.tags?.length ? `#${e.tags.join(" #")}` : "—")}
        </span>
        <button
          type="button"
          onClick={() => void toggleDetails()}
          disabled={!kek}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 disabled:opacity-40"
        >
          {!kek ? "locked" : open ? "hide" : "details"}
        </button>
        <SourceBadge source={e._source} />
      </div>
      {open && (
        <div className="mt-2 pl-28 text-xs text-zinc-300 space-y-1 border-l border-zinc-800 ml-2">
          {!kek ? (
            <span className="text-zinc-500">Unlock to read encrypted fields.</span>
          ) : busy ? (
            <span className="text-zinc-500">Decrypting…</span>
          ) : err ? (
            <span className="text-rose-300">{err}</span>
          ) : parsed ? (
            <DecryptedSummary entryType={e.entry_type} payload={parsed} />
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
}: {
  entryType: string;
  payload: Record<string, unknown>;
}) {
  if (entryType === "DAILY_CHECKIN") {
    const notes = typeof payload.notes === "string" ? payload.notes : "";
    const tod = typeof payload.time_of_day === "string" ? payload.time_of_day : "";
    const legacy: string[] = [];
    if (typeof payload.focus_score === "number") legacy.push(`focus (in notes) ${payload.focus_score}`);
    if (typeof payload.social_battery === "number")
      legacy.push(`social (in notes) ${payload.social_battery}`);
    if (typeof payload.stress_score === "number") legacy.push(`stress (in notes) ${payload.stress_score}`);
    return (
      <div className="space-y-1">
        {tod && <div className="text-zinc-500">Time of day: {tod}</div>}
        {legacy.length > 0 && (
          <div className="text-[10px] text-amber-200/80">
            Older check-ins stored these only in ciphertext: {legacy.join(" · ")}
          </div>
        )}
        {notes ? (
          <div className="whitespace-pre-wrap text-zinc-200">{notes}</div>
        ) : (
          <div className="text-zinc-500">(no notes in ciphertext)</div>
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
  if (typeof e.focus_score === "number") parts.push(`focus ${e.focus_score}`);
  if (typeof e.social_battery_score === "number") parts.push(`social ${e.social_battery_score}`);
  if (typeof e.stress_score === "number") parts.push(`stress ${e.stress_score}`);
  if (typeof e.session_duration_min === "number") parts.push(`${e.session_duration_min} min`);
  if (e.entry_type === "HABIT_LOG") {
    const hc = e.habit_completed as unknown;
    if (hc === true || hc === 1) parts.push("habit ✓");
    else if (hc === false || hc === 0) parts.push("habit ✗");
    if (typeof e.habit_value === "number") parts.push(`val ${e.habit_value}`);
  }
  if (typeof e.resentment_score === "number") parts.push(`R${e.resentment_score}`);
  if (typeof e.guilt_score === "number") parts.push(`G${e.guilt_score}`);
  if (typeof e.shame_score === "number") parts.push(`S${e.shame_score}`);
  if (typeof e.fear_score === "number") parts.push(`F${e.fear_score}`);
  return parts.join(" · ");
}
