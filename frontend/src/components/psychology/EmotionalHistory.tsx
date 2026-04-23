import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import type { MergedEntry } from "../../hooks/useEntries";
import { useDecryptedEntries } from "../../hooks/useDecryptedEntries";

interface EmotionalPayload {
  v?: number;
  resentment?: { expectation?: string; reality?: string; trigger?: string };
  guilt?: { my_action?: string; perceived_expectation?: string };
  shame?: { action?: string; ideal_self?: string };
  fear?: { threat?: string; missing_solution?: string };
  reflection?: string;
  cognitive_distortion?: string;
}

/**
 * List of recent EMOTIONAL_STATE entries.
 *
 * Design: scores are always visible (open fields, zero-cost). The full
 * gap-model breakdown is encrypted — we decrypt lazily on click so the
 * page stays fast and no decrypt happens unless the user asks for it.
 */
export default function EmotionalHistory({
  entries,
  limit = 15,
}: {
  entries: MergedEntry[];
  limit?: number;
}) {
  const { kek } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useMemo(
    () => entries.filter((e) => e.entry_type === "EMOTIONAL_STATE").slice(0, limit),
    [entries, limit],
  );

  // Only decrypt the currently-expanded row — plus whatever we've expanded
  // earlier in the session (the hook caches by id).
  const target = useMemo(
    () => (openId ? items.filter((e) => e.id === openId) : []),
    [openId, items],
  );
  const { data, errors, pending } = useDecryptedEntries<EmotionalPayload>(target, kek);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-200">Emotional history</h3>
        <span className="text-[11px] text-zinc-500">
          scores open · text decrypted on click
        </span>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-zinc-500 py-6 text-center">
          No emotional state entries yet.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {items.map((e) => {
            const isOpen = openId === e.id;
            const payload = data[e.id];
            const err = errors[e.id];
            return (
              <li key={e.id} className="py-2">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : e.id)}
                  className="w-full flex items-center gap-3 text-left"
                >
                  <span className="text-xs text-zinc-500 w-28 shrink-0 tabular-nums">
                    {formatTs(e.timestamp)}
                  </span>
                  <ScoreRow entry={e} />
                  <span className="ml-auto text-[11px] text-zinc-500">
                    {isOpen ? "hide" : "show"}
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-2 pl-28 pr-2 text-sm">
                    {!kek ? (
                      <div className="text-zinc-500 text-xs">
                        Unlock required to decrypt this entry.
                      </div>
                    ) : pending && !payload ? (
                      <div className="text-zinc-500 text-xs">Decrypting…</div>
                    ) : err ? (
                      <div className="text-rose-300 text-xs">Decrypt error: {err}</div>
                    ) : payload ? (
                      <PayloadView payload={payload} />
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

const SCORE_CONF = [
  { key: "resentment_score", label: "R", color: "text-rose-400" },
  { key: "guilt_score", label: "G", color: "text-amber-400" },
  { key: "shame_score", label: "S", color: "text-fuchsia-400" },
  { key: "fear_score", label: "F", color: "text-sky-400" },
] as const;

function ScoreRow({ entry }: { entry: MergedEntry }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
      {SCORE_CONF.map(({ key, label, color }) => {
        const v = entry[key as keyof MergedEntry] as number | null | undefined;
        const has = typeof v === "number";
        return (
          <span
            key={key}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
              has
                ? "border-zinc-700 bg-zinc-900"
                : "border-zinc-800 bg-zinc-950 text-zinc-600"
            }`}
          >
            <span className={color}>{label}</span>
            <span>{has ? v : "—"}</span>
          </span>
        );
      })}
    </div>
  );
}

function PayloadView({ payload }: { payload: EmotionalPayload }) {
  const hasAny =
    payload.resentment ||
    payload.guilt ||
    payload.shame ||
    payload.fear ||
    payload.reflection ||
    payload.cognitive_distortion;
  if (!hasAny) {
    return <div className="text-zinc-500 text-xs">(no text for this entry)</div>;
  }
  return (
    <div className="space-y-2">
      {payload.resentment && (
        <Section title="Resentment" tint="text-rose-300">
          <Kv k="Expected" v={payload.resentment.expectation} />
          <Kv k="Reality" v={payload.resentment.reality} />
          <Kv k="Trigger" v={payload.resentment.trigger} />
        </Section>
      )}
      {payload.guilt && (
        <Section title="Guilt" tint="text-amber-300">
          <Kv k="My action" v={payload.guilt.my_action} />
          <Kv k="Perceived expectation" v={payload.guilt.perceived_expectation} />
        </Section>
      )}
      {payload.shame && (
        <Section title="Shame" tint="text-fuchsia-300">
          <Kv k="Action" v={payload.shame.action} />
          <Kv k="Ideal self" v={payload.shame.ideal_self} />
        </Section>
      )}
      {payload.fear && (
        <Section title="Fear" tint="text-sky-300">
          <Kv k="Threat" v={payload.fear.threat} />
          <Kv k="Missing resource" v={payload.fear.missing_solution} />
        </Section>
      )}
      {payload.reflection && (
        <Section title="Reflection" tint="text-emerald-300">
          <div className="text-zinc-300 whitespace-pre-wrap">{payload.reflection}</div>
        </Section>
      )}
      {payload.cognitive_distortion && (
        <div className="text-xs text-zinc-400">
          Distortion: <span className="text-zinc-200">{payload.cognitive_distortion}</span>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  tint,
  children,
}: {
  title: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={`text-[11px] uppercase tracking-wide ${tint}`}>{title}</div>
      <div className="mt-0.5 space-y-0.5">{children}</div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="text-xs">
      <span className="text-zinc-500">{k}:</span>{" "}
      <span className="text-zinc-200 whitespace-pre-wrap">{v}</span>
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
