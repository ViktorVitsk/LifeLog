import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useSync } from "../context/SyncContext";
import { useHabits } from "../hooks/useCatalog";
import { api } from "../lib/api";
import { decryptEntry } from "../lib/crypto";
import { encryptLifePayload, enqueueLife, flushLifeQueue } from "../lib/lifeStore";

function newId(): string {
  return crypto.randomUUID();
}

export default function LifePage() {
  const { token, kek, userId } = useAuth();
  const { t } = useLocale();
  const { trigger } = useSync();
  const qc = useQueryClient();
  const habits = useHabits().data ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [enough, setEnough] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [habitId, setHabitId] = useState("");
  const [statement, setStatement] = useState("");
  const [proposal, setProposal] = useState("");
  const [goalForAction, setGoalForAction] = useState("");

  const lifeQuery = useQuery({
    queryKey: ["life", userId],
    enabled: Boolean(token && userId),
    queryFn: () => api.getLife(token!),
  });
  const bundle = lifeQuery.data;

  async function persist(kind: "goal" | "memory" | "action" | "feedback", payload: Record<string, unknown>) {
    if (!kek) {
      setMsg(t.unlockForExport);
      return;
    }
    await enqueueLife(kind, payload);
    if (token && userId) {
      await flushLifeQueue(token, userId);
      await qc.invalidateQueries({ queryKey: ["life", userId] });
      trigger();
    }
  }

  async function onCreateGoal() {
    if (!kek || !title.trim()) return;
    const blob = await encryptLifePayload(kek, {
      title: title.trim(),
      why: why.trim(),
      enough_result: enough.trim(),
      baseline: "",
      constraints: "",
      next_step: nextStep.trim(),
      values: [],
    });
    await persist("goal", {
      id: newId(),
      state: "active",
      habit_ids: habitId ? [habitId] : [],
      skill_ids: [],
      entry_ids: [],
      ...blob,
    });
    setTitle("");
    setWhy("");
    setEnough("");
    setNextStep("");
    setMsg(t.lifeGoalSaved);
  }

  async function onCreateMemory() {
    if (!kek || !statement.trim()) return;
    const blob = await encryptLifePayload(kek, { statement: statement.trim(), sensitive_grounds: "" });
    await persist("memory", {
      id: newId(),
      kind: "preference",
      state: "proposed",
      origin: "user",
      entry_ids: [],
      ...blob,
    });
    setStatement("");
    setMsg(t.lifeMemorySaved);
  }

  async function onAcceptMemory(id: string, version: number, kind: string, origin: string, entry_ids: string[], dek: string, ct: string) {
    await persist("memory", {
      id,
      kind,
      state: "accepted",
      origin,
      entry_ids,
      encrypted_dek: dek,
      encrypted_content: ct,
      version,
      reviewed_at: new Date().toISOString(),
    });
    setMsg(t.lifeMemoryAccepted);
  }

  async function onCreateAction() {
    if (!kek || !goalForAction || !proposal.trim()) return;
    const blob = await encryptLifePayload(kek, { proposal: proposal.trim(), grounds: "", chosen_try: proposal.trim() });
    const review = new Date();
    review.setDate(review.getDate() + 7);
    await persist("action", {
      id: newId(),
      goal_id: goalForAction,
      state: "accepted",
      review_at: review.toISOString(),
      ...blob,
    });
    setProposal("");
    setMsg(t.lifeActionSaved);
  }

  async function onFeedback(actionId: string, outcome: string) {
    if (!kek) return;
    const blob = await encryptLifePayload(kek, {
      difficulty: "",
      usefulness: "",
      what_changed: "",
      side_effects: "",
      continue_notes: "",
    });
    await persist("feedback", { id: newId(), action_id: actionId, outcome_kind: outcome, ...blob });
    setMsg(t.lifeFeedbackSaved);
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.lifeTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.lifeHint}</p>
      </div>
      {msg && <p className="text-xs text-zinc-400">{msg}</p>}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <h2 className="text-sm font-medium">{t.lifeNewGoal}</h2>
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalWhy} value={why} onChange={(e) => setWhy(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalEnough} value={enough} onChange={(e) => setEnough(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalNext} value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
        <select className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" value={habitId} onChange={(e) => setHabitId(e.target.value)}>
          <option value="">{t.lifeOptionalHabit}</option>
          {habits.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
        <button type="button" className="min-h-[44px] px-3 rounded bg-indigo-600 text-sm" onClick={() => void onCreateGoal()}>
          {t.lifeSaveGoal}
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t.lifeGoals}</h2>
        {(bundle?.goals ?? []).map((g) => (
          <CipherCard key={g.id} kek={kek} dek={g.encrypted_dek} ct={g.encrypted_content} fallback={g.id}>
            {(plain) => (
              <div className="text-sm">
                <div className="font-medium">{String(plain.title ?? t.lifeGoalTitle)}</div>
                <div className="text-zinc-500">{g.state}</div>
              </div>
            )}
          </CipherCard>
        ))}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <h2 className="text-sm font-medium">{t.lifeNewMemory}</h2>
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeMemoryStatement} value={statement} onChange={(e) => setStatement(e.target.value)} />
        <button type="button" className="min-h-[44px] px-3 rounded bg-zinc-800 text-sm" onClick={() => void onCreateMemory()}>
          {t.lifeSaveMemory}
        </button>
        {(bundle?.memory ?? []).map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
            <CipherCard kek={kek} dek={m.encrypted_dek} ct={m.encrypted_content} fallback={m.kind}>
              {(plain) => <span>{String(plain.statement ?? m.kind)} · {m.state}</span>}
            </CipherCard>
            {m.state === "proposed" && (
              <button type="button" className="text-xs px-2 py-1 rounded bg-indigo-600" onClick={() => void onAcceptMemory(m.id, m.version ?? 1, m.kind, m.origin ?? "user", m.entry_ids ?? [], m.encrypted_dek, m.encrypted_content)}>
                {t.lifeAccept}
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <h2 className="text-sm font-medium">{t.lifeNewAction}</h2>
        <select className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" value={goalForAction} onChange={(e) => setGoalForAction(e.target.value)}>
          <option value="">{t.lifePickGoal}</option>
          {(bundle?.goals ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.id.slice(0, 8)}</option>
          ))}
        </select>
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeActionTry} value={proposal} onChange={(e) => setProposal(e.target.value)} />
        <button type="button" className="min-h-[44px] px-3 rounded bg-zinc-800 text-sm" onClick={() => void onCreateAction()}>
          {t.lifeSaveAction}
        </button>
        {(bundle?.actions ?? []).map((a) => (
          <div key={a.id} className="space-y-1 text-sm">
            <CipherCard kek={kek} dek={a.encrypted_dek} ct={a.encrypted_content} fallback={a.state}>
              {(plain) => <span>{String(plain.chosen_try ?? plain.proposal ?? a.state)}</span>}
            </CipherCard>
            <div className="flex flex-wrap gap-1">
              {["not_tried", "not_suitable", "tried_no_effect", "tried_helped"].map((outcome) => (
                <button key={outcome} type="button" className="text-[11px] px-2 py-1 rounded bg-zinc-800" onClick={() => void onFeedback(a.id, outcome)}>
                  {outcome}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function CipherCard({
  kek,
  dek,
  ct,
  fallback,
  children,
}: {
  kek: CryptoKey | null;
  dek: string;
  ct: string;
  fallback: string;
  children: (plain: Record<string, unknown>) => ReactNode;
}) {
  const [plain, setPlain] = useState<Record<string, unknown> | null>(null);
  if (!kek) return <div className="text-xs text-zinc-500">{fallback}</div>;
  if (!plain) {
    void decryptEntry(ct, dek, kek)
      .then((raw) => setPlain(JSON.parse(raw) as Record<string, unknown>))
      .catch(() => setPlain({}));
    return <div className="text-xs text-zinc-500">…</div>;
  }
  return <>{children(plain)}</>;
}
