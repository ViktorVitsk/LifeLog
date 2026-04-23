import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { useDecryptedEntries } from "../../hooks/useDecryptedEntries";

interface SkillPayload {
  v?: number;
  custom_metrics?: Record<string, unknown>;
  what_worked?: string;
  what_to_improve?: string;
}

/**
 * Recent SKILL_SESSION rows for the selected skill — open duration always
 * visible; encrypted session notes + custom_metrics decrypt on demand.
 */
export default function SkillSessionHistory({
  entries,
  skillId,
  limit = 20,
}: {
  entries: MergedEntry[];
  skillId: string;
  limit?: number;
}) {
  const { kek } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            e.entry_type === "SKILL_SESSION" &&
            e.skill_id != null &&
            String(e.skill_id) === String(skillId),
        )
        .slice(0, limit),
    [entries, skillId, limit],
  );

  const target = useMemo(
    () => (openId ? rows.filter((e) => e.id === openId) : []),
    [openId, rows],
  );
  const { data, errors, pending } = useDecryptedEntries<SkillPayload>(target, kek);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-sm font-medium text-zinc-200 mb-2">Session log</h3>
      <p className="text-[11px] text-zinc-500 mb-2">
        Duration is open metadata; metrics & notes decrypt when you expand.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No sessions for this skill yet.</p>
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
                  <span className="text-zinc-200 font-mono text-xs">
                    {typeof e.session_duration_min === "number"
                      ? `${e.session_duration_min} min`
                      : "—"}
                  </span>
                  <span className="ml-auto text-[11px] text-zinc-500">{isOpen ? "hide" : "details"}</span>
                </button>
                {isOpen && (
                  <div className="mt-2 pl-32 pr-1 text-xs space-y-2">
                    {!kek ? (
                      <div className="text-zinc-500">Unlock required to decrypt.</div>
                    ) : pending && !p && !err ? (
                      <div className="text-zinc-500">Decrypting…</div>
                    ) : err ? (
                      <div className="text-rose-300">{err}</div>
                    ) : p ? (
                      <SkillPayloadView payload={p} />
                    ) : null}
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

function SkillPayloadView({ payload }: { payload: SkillPayload }) {
  const cm = payload.custom_metrics;
  const hasCm = cm && typeof cm === "object" && Object.keys(cm).length > 0;
  return (
    <div className="space-y-2 text-zinc-300">
      {hasCm && cm && (
        <div>
          <div className="text-[10px] uppercase text-zinc-500 mb-0.5">Custom metrics</div>
          <ul className="font-mono text-[11px] space-y-0.5">
            {Object.entries(cm).map(([k, v]) => (
              <li key={k}>
                <span className="text-zinc-500">{k}:</span> {String(v)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {payload.what_worked ? (
        <div>
          <div className="text-[10px] uppercase text-zinc-500">What worked</div>
          <div className="whitespace-pre-wrap text-zinc-200">{payload.what_worked}</div>
        </div>
      ) : null}
      {payload.what_to_improve ? (
        <div>
          <div className="text-[10px] uppercase text-zinc-500">To improve</div>
          <div className="whitespace-pre-wrap text-zinc-200">{payload.what_to_improve}</div>
        </div>
      ) : null}
      {!hasCm && !payload.what_worked && !payload.what_to_improve && (
        <div className="text-zinc-500">(no encrypted fields)</div>
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
