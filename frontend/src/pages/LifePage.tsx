import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import CipherCard, { useDecryptedMap } from "../components/CipherCard";
import WeeklyReviewCard from "../components/WeeklyReviewCard";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useSync } from "../context/SyncContext";
import { useHabits } from "../hooks/useCatalog";
import { useEntries } from "../hooks/useEntries";
import { useMergedLife } from "../hooks/useMergedLife";
import type { LifeActionRead, LifeFeedbackRead, LifeGoalRead, LifeMemoryRead } from "../lib/api";
import { encryptLifePayload, enqueueLife, flushLifeQueue } from "../lib/lifeStore";
import { readLifeRow, resolveLifeApplyLocal, resolveLifeKeepLocalCopy, resolveLifeKeepServer } from "../lib/lifeQueue";
import { ActionChangedError, FeedbackChangedError, SubmissionReusedError, commitFeedbackCorrection, commitFeedbackDecision, listLifeOps, resumeFeedbackOps } from "../lib/lifeOp";
import { actionPatchForDecision, USER_OUTCOMES, ACTION_DECISIONS, outcomeSourceOf, type ActionDecision, type UserOutcome } from "../lib/feedbackOutcome";
import { queueSyncLabel } from "../lib/mergeLife";
import type { SaveScope } from "../lib/accountScope";
import type { TStrings } from "../i18n/strings";
import type { LifeOp, PendingLife } from "../db/offlineQueue";
import { calendarDayKey, getAccountTimeZone, shiftCivilDay, zonedWallTimeToUtc } from "../lib/dates";
import { buildWeeklyReview, reviewFlagsFromQueue } from "../lib/weeklyReview";

function newId(): string {
  return crypto.randomUUID();
}

function plusDays(days: number): string {
  const zone = getAccountTimeZone();
  const day = shiftCivilDay(calendarDayKey(new Date(), zone), days);
  return zonedWallTimeToUtc(day, 12, 0, zone).toISOString();
}

function outcomeLabel(kind: string, t: TStrings): string {
  if (kind === "not_tried") return t.outcomeNotTried;
  if (kind === "not_suitable") return t.outcomeNotSuitable;
  if (kind === "tried_no_effect") return t.outcomeNoEffect;
  if (kind === "tried_helped") return t.outcomeHelped;
  if (kind === "unevaluated") return t.outcomeUnevaluated;
  return kind;
}

function decisionLabel(kind: string, t: TStrings): string {
  if (kind === "continue") return t.lifeContinue;
  if (kind === "change_plan") return t.lifeDecisionChangePlan;
  if (kind === "complete") return t.lifeComplete;
  if (kind === "stop") return t.lifeStop;
  return kind;
}

export default function LifePage() {
  const { token, kek, userId, timezone } = useAuth();
  const { t } = useLocale();
  const { trigger } = useSync();
  const qc = useQueryClient();
  const habits = useHabits().data ?? [];
  const { bundle, statuses, local } = useMergedLife();
  const { entries } = useEntries();
  const [params] = useSearchParams();
  const focusActionId = params.get("action");
  const focusMode = params.get("focus");
  const goalPlain = useDecryptedMap(bundle.goals, kek);
  const actionPlain = useDecryptedMap(bundle.actions, kek);
  const feedbackPlain = useDecryptedMap(bundle.feedback, kek);
  const flags = reviewFlagsFromQueue(local);
  const weekly = buildWeeklyReview({
    now: new Date(),
    timeZone: timezone || getAccountTimeZone(),
    entries,
    bundle,
    goalPlain,
    actionPlain,
    feedbackPlain,
    conflictIds: flags.conflictIds,
    preliminary: flags.preliminary,
  });
  const missingAction = Boolean(focusActionId && !bundle.actions.some((a) => a.id === focusActionId));
  const [ops, setOps] = useState<LifeOp[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [enough, setEnough] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [habitId, setHabitId] = useState("");
  const [statement, setStatement] = useState("");
  const [proposal, setProposal] = useState("");
  const [goalForAction, setGoalForAction] = useState("");
  const [resultMetric, setResultMetric] = useState("");
  const [reviewAt, setReviewAt] = useState(() => plusDays(7).slice(0, 10));

  async function refreshOps() {
    if (!userId) return;
    setOps(await listLifeOps(userId));
  }

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      if (token && (typeof navigator === "undefined" || navigator.onLine)) {
        await flushLifeQueue(token, userId).catch(() => undefined);
      }
      await resumeFeedbackOps(userId);
      await refreshOps();
    })();
  }, [token, userId]);

  useEffect(() => {
    if (!focusActionId) return;
    document.getElementById(`life-action-${focusActionId}`)?.scrollIntoView({ block: "center" });
  }, [focusActionId, bundle.actions.length]);

  async function persist(
    kind: "goal" | "memory" | "action" | "feedback",
    payload: Record<string, unknown>,
    scope?: SaveScope,
  ) {
    if (!kek) {
      setMsg(t.unlockForExport);
      return;
    }
    await enqueueLife(kind, payload, scope);
    if (token && userId && (typeof navigator === "undefined" || navigator.onLine)) {
      try {
        await flushLifeQueue(token, userId);
      } catch {
        /* stay local */
      }
      await qc.invalidateQueries({ queryKey: ["life", userId] });
      trigger();
    }
  }

  function badge(id: string) {
    const status = statuses.get(id);
    const label = status ? queueSyncLabel(status) : "synced";
    const text =
      label === "synced"
        ? t.onServer
        : label === "rejected"
          ? t.rejected
          : label === "conflict"
            ? t.syncConflict
            : label === "error"
              ? t.syncError
              : t.onDevice;
    const cls =
      label === "synced"
        ? "text-emerald-400"
        : label === "rejected" || label === "conflict" || label === "error"
          ? "text-rose-300"
          : "text-amber-200";
    return <span className={`text-[11px] ${cls}`}>{text}</span>;
  }

  async function resolveConflict(id: string, mode: "server" | "local" | "copy") {
    if (!userId) return;
    if (mode === "server") await resolveLifeKeepServer(id, userId);
    else if (mode === "local") await resolveLifeApplyLocal(id, userId);
    else await resolveLifeKeepLocalCopy(id, userId, newId());
    if (token && (typeof navigator === "undefined" || navigator.onLine)) {
      await flushLifeQueue(token, userId).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ["life", userId] });
      trigger();
    }
  }

  function conflictPanel(id: string) {
    const row = local.find((item) => item.id === id);
    if (!row || row.status !== "conflict") return null;
    return <ConflictPanel row={row} kek={kek} t={t} onResolve={(mode) => void resolveConflict(id, mode)} />;
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
    await persist(
      "goal",
      {
        id: newId(),
        state: "active",
        habit_ids: habitId ? [habitId] : [],
        skill_ids: [],
        entry_ids: [],
        encrypted_dek: blob.encrypted_dek,
        encrypted_content: blob.encrypted_content,
      },
      blob.scope,
    );
    setTitle("");
    setWhy("");
    setEnough("");
    setNextStep("");
    setMsg(t.lifeGoalSaved);
  }

  async function onCreateMemory() {
    if (!kek || !statement.trim()) return;
    const blob = await encryptLifePayload(kek, { statement: statement.trim(), sensitive_grounds: "" });
    await persist(
      "memory",
      {
        id: newId(),
        kind: "preference",
        state: "proposed",
        origin: "user",
        entry_ids: [],
        encrypted_dek: blob.encrypted_dek,
        encrypted_content: blob.encrypted_content,
      },
      blob.scope,
    );
    setStatement("");
    setMsg(t.lifeMemorySaved);
  }

  async function writeMemory(m: LifeMemoryRead, patch: Record<string, unknown>, body?: Record<string, unknown>) {
    if (!kek) return;
    let dek = m.encrypted_dek;
    let ct = m.encrypted_content;
    let scope: SaveScope | undefined;
    if (body) {
      const blob = await encryptLifePayload(kek, body);
      dek = blob.encrypted_dek;
      ct = blob.encrypted_content;
      scope = blob.scope;
    }
    await persist(
      "memory",
      {
        id: m.id,
        kind: m.kind,
        origin: m.origin ?? "user",
        entry_ids: m.entry_ids ?? [],
        reviewed_at: m.reviewed_at ?? null,
        encrypted_dek: dek,
        encrypted_content: ct,
        version: m.version,
        ...patch,
      },
      scope,
    );
  }

  async function onCreateAction() {
    if (!kek || !goalForAction || !proposal.trim()) return;
    const blob = await encryptLifePayload(kek, {
      proposal: proposal.trim(),
      grounds: "",
      chosen_try: proposal.trim(),
    });
    const review = reviewAt ? new Date(`${reviewAt}T12:00:00`).toISOString() : plusDays(7);
    await persist(
      "action",
      {
        id: newId(),
        goal_id: goalForAction,
        state: "accepted",
        result_metric: resultMetric.trim() || null,
        review_at: review,
        encrypted_dek: blob.encrypted_dek,
        encrypted_content: blob.encrypted_content,
      },
      blob.scope,
    );
    setProposal("");
    setResultMetric("");
    setMsg(t.lifeActionSaved);
  }

  async function writeAction(a: LifeActionRead, patch: Record<string, unknown>) {
    await persist("action", {
      id: a.id,
      goal_id: a.goal_id,
      state: a.state,
      result_metric: a.result_metric ?? null,
      period_start: a.period_start ?? null,
      period_end: a.period_end ?? null,
      review_at: a.review_at ?? null,
      encrypted_dek: a.encrypted_dek,
      encrypted_content: a.encrypted_content,
      version: a.version,
      ...patch,
    });
  }

  async function onFeedback(
    action: LifeActionRead,
    outcome: string,
    decision: string,
    fields: { what_changed: string; difficulty: string; side_effects: string; observed_on: string; plan_text: string },
    submissionId: string,
    existing?: LifeFeedbackRead,
  ): Promise<boolean> {
    if (!kek) return false;
    if (!outcome) {
      setMsg(t.lifeNeedOutcome);
      return false;
    }
    if (!existing && !decision) {
      setMsg(t.lifeNeedDecision);
      return false;
    }
    if (!fields.what_changed.trim() && !fields.difficulty.trim() && !fields.side_effects.trim()) {
      setMsg(t.reviewFields);
      return false;
    }
    try {
      if (existing) {
        const plain = feedbackPlain[existing.id] ?? {};
        const localRow = await readLifeRow(existing.id);
        await commitFeedbackCorrection({
          kek,
          action,
          outcome,
          fields,
          submissionId,
          existingFeedback: existing,
          existingPlain: plain,
          expectedFeedbackVersion: existing.version,
          expectedFeedbackLocalRev: localRow?.local_rev ?? 0,
          planSnapshot: typeof plain.plan_snapshot === "string" ? String(plain.plan_snapshot) : null,
        });
      } else {
        await commitFeedbackDecision({
          kek,
          action,
          outcome,
          decision,
          fields,
          submissionId,
          planSnapshot: typeof actionPlain[action.id]?.chosen_try === "string"
            ? String(actionPlain[action.id].chosen_try)
            : typeof actionPlain[action.id]?.proposal === "string"
              ? String(actionPlain[action.id].proposal)
              : null,
        });
      }
      if (token && userId && (typeof navigator === "undefined" || navigator.onLine)) {
        await flushLifeQueue(token, userId).catch(() => undefined);
        await resumeFeedbackOps(userId);
      }
      await qc.invalidateQueries({ queryKey: ["life", userId] });
      trigger();
      await refreshOps();
      setMsg(t.lifeFeedbackSaved);
      return true;
    } catch (e) {
      if (e instanceof ActionChangedError) setMsg(t.lifeActionRemoteChanged);
      else if (e instanceof FeedbackChangedError) setMsg(t.lifeFeedbackRemoteChanged);
      else if (e instanceof SubmissionReusedError) setMsg(t.lifeSubmissionReused);
      else if ((e as Error).message === "outcome_required") setMsg(t.lifeNeedOutcome);
      else if ((e as Error).message === "decision_required") setMsg(t.lifeNeedDecision);
      else setMsg((e as Error).message);
      return false;
    }
  }

  async function onActionDecision(action: LifeActionRead, decision: ActionDecision) {
    await writeAction(action, actionPatchForDecision(decision, action.state));
    setMsg(t.lifeActionSaved);
  }

  async function onChangePlan(action: LifeActionRead, text: string) {
    if (!kek || !text.trim()) return;
    const blob = await encryptLifePayload(kek, { proposal: text.trim(), chosen_try: text.trim(), grounds: "" });
    await writeAction(action, { encrypted_dek: blob.encrypted_dek, encrypted_content: blob.encrypted_content });
    setMsg(t.lifeActionSaved);
  }

  function goalTitle(g: LifeGoalRead): string {
    const title = goalPlain[g.id]?.title;
    return typeof title === "string" && title.trim() ? title : g.id.slice(0, 8);
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.lifeTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.lifeHint}</p>
      </div>
      {msg && <p className="text-xs text-zinc-400">{msg}</p>}

      {missingAction && <p className="text-xs text-amber-200">{t.weeklySourceMissing}</p>}

      <WeeklyReviewCard
        review={weekly}
        knownEntryIds={new Set(entries.map((e) => e.id))}
        knownActionIds={new Set(bundle.actions.map((a) => a.id))}
        onSave={() => {
          const blob = new Blob([JSON.stringify(weekly, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `lifelog-weekly-${weekly.current.period.start_day}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}
      />

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <h2 className="text-sm font-medium">{t.lifeNewGoal}</h2>
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalWhy} value={why} onChange={(e) => setWhy(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalEnough} value={enough} onChange={(e) => setEnough(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeGoalNext} value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
        <select className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" value={habitId} onChange={(e) => setHabitId(e.target.value)}>
          <option value="">{t.lifeOptionalHabit}</option>
          {habits.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <button type="button" className="min-h-[44px] px-3 rounded bg-indigo-600 text-sm" onClick={() => void onCreateGoal()}>
          {t.lifeSaveGoal}
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t.lifeGoals}</h2>
        {bundle.goals.map((g) => (
          <div key={g.id} className="rounded border border-zinc-800 p-3 space-y-1">
            <div className="flex justify-between gap-2">
              <CipherCard kek={kek} dek={g.encrypted_dek} ct={g.encrypted_content} fallback={g.id}>
                {(plain) => (
                  <div className="text-sm">
                    <div className="font-medium">{String(plain.title ?? t.lifeGoalTitle)}</div>
                    <div className="text-zinc-500">{g.state}</div>
                  </div>
                )}
              </CipherCard>
              {badge(g.id)}
            </div>
            {conflictPanel(g.id)}
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <h2 className="text-sm font-medium">{t.lifeNewMemory}</h2>
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeMemoryStatement} value={statement} onChange={(e) => setStatement(e.target.value)} />
        <button type="button" className="min-h-[44px] px-3 rounded bg-zinc-800 text-sm" onClick={() => void onCreateMemory()}>
          {t.lifeSaveMemory}
        </button>
        {bundle.memory.map((m) => (
          <MemoryRow
            key={m.id}
            item={m}
            kek={kek}
            badge={badge(m.id)}
            t={t}
            onAccept={() => void writeMemory(m, { state: "accepted", reviewed_at: new Date().toISOString() })}
            onDispute={() => void writeMemory(m, { state: "disputed", reviewed_at: new Date().toISOString() })}
            onStale={() => void writeMemory(m, { state: "stale", reviewed_at: new Date().toISOString() })}
            onDelete={() => void writeMemory(m, { deleted: true })}
            onEdit={(text) => void writeMemory(m, { state: m.state, reviewed_at: new Date().toISOString() }, { statement: text, sensitive_grounds: "" })}
            extra={conflictPanel(m.id)}
          />
        ))}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <h2 className="text-sm font-medium">{t.lifeNewAction}</h2>
        <select className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" value={goalForAction} onChange={(e) => setGoalForAction(e.target.value)}>
          <option value="">{t.lifePickGoal}</option>
          {bundle.goals.map((g) => (
            <option key={g.id} value={g.id}>
              {goalTitle(g)}
            </option>
          ))}
        </select>
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeActionTry} value={proposal} onChange={(e) => setProposal(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm" placeholder={t.lifeResultMetric} value={resultMetric} onChange={(e) => setResultMetric(e.target.value)} />
        <label className="block text-xs text-zinc-400">
          {t.lifeReviewAt}
          <input
            type="date"
            className="mt-1 w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-sm text-zinc-100"
            value={reviewAt}
            onChange={(e) => setReviewAt(e.target.value)}
          />
        </label>
        <button type="button" className="min-h-[44px] px-3 rounded bg-zinc-800 text-sm" onClick={() => void onCreateAction()}>
          {t.lifeSaveAction}
        </button>
        {bundle.actions.map((a) => (
          <ActionRow
            key={a.id}
            highlighted={a.id === focusActionId}
            focusResult={a.id === focusActionId && focusMode === "result"}
            action={a}
            goalName={goalTitle(bundle.goals.find((g) => g.id === a.goal_id) ?? { id: a.goal_id } as LifeGoalRead)}
            kek={kek}
            badge={badge(a.id)}
            t={t}
            outcomeLabel={outcomeLabel}
            feedback={bundle.feedback.filter((f) => f.action_id === a.id)}
            feedbackPlain={feedbackPlain}
            op={ops.find((item) => item.action_id === a.id && item.status !== "done")}
            extra={conflictPanel(a.id)}
            onReviewAt={(iso) => void writeAction(a, { review_at: iso })}
            onChangePlan={(text) => void onChangePlan(a, text)}
            onActionDecision={(decision) => void onActionDecision(a, decision)}
            onFeedback={(outcome, decision, fields, submissionId, existing) =>
              onFeedback(a, outcome, decision, fields, submissionId, existing)
            }
          />
        ))}
      </section>
    </div>
  );
}

function MemoryRow({
  item,
  kek,
  badge,
  t,
  onAccept,
  onDispute,
  onStale,
  onDelete,
  onEdit,
  extra,
}: {
  item: LifeMemoryRead;
  kek: CryptoKey | null;
  badge: ReactNode;
  t: TStrings;
  onAccept: () => void;
  onDispute: () => void;
  onStale: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
  extra?: ReactNode;
}) {
  const [editing, setEditing] = useState("");
  return (
    <div className="space-y-1 text-sm border-t border-zinc-800 pt-2">
      <div className="flex items-center justify-between gap-2">
        <CipherCard kek={kek} dek={item.encrypted_dek} ct={item.encrypted_content} fallback={item.kind}>
          {(plain) => <span>{String(plain.statement ?? item.kind)} · {item.state}</span>}
        </CipherCard>
        {badge}
      </div>
      {(item.entry_ids ?? []).length > 0 && (
        <p className="text-[11px] text-zinc-500">
          {t.lifeSources}: {(item.entry_ids ?? []).join(", ")}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {item.state === "proposed" && (
          <button type="button" className="text-xs px-2 py-1 rounded bg-indigo-600" onClick={onAccept}>
            {t.lifeAccept}
          </button>
        )}
        <button type="button" className="text-xs px-2 py-1 rounded bg-zinc-800" onClick={onDispute}>
          {t.lifeDispute}
        </button>
        <button type="button" className="text-xs px-2 py-1 rounded bg-zinc-800" onClick={onStale}>
          {t.lifeStale}
        </button>
        <button type="button" className="text-xs px-2 py-1 rounded bg-zinc-800" onClick={onDelete}>
          {t.lifeDelete}
        </button>
      </div>
      <div className="flex gap-1">
        <input
          className="flex-1 rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs"
          placeholder={t.edit}
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
        />
        <button
          type="button"
          className="text-xs px-2 py-1 rounded bg-zinc-800"
          onClick={() => {
            if (editing.trim()) onEdit(editing.trim());
            setEditing("");
          }}
        >
          {t.save}
        </button>
      </div>
      {extra}
    </div>
  );
}

function ActionRow({
  action,
  goalName,
  kek,
  badge,
  t,
  outcomeLabel,
  feedback,
  feedbackPlain,
  op,
  extra,
  highlighted,
  focusResult,
  onReviewAt,
  onChangePlan,
  onActionDecision,
  onFeedback,
}: {
  action: LifeActionRead;
  goalName: string;
  kek: CryptoKey | null;
  badge: ReactNode;
  t: TStrings;
  outcomeLabel: (kind: string, t: TStrings) => string;
  extra?: ReactNode;
  highlighted?: boolean;
  focusResult?: boolean;
  feedback: LifeFeedbackRead[];
  feedbackPlain: Record<string, Record<string, unknown>>;
  op?: LifeOp;
  onReviewAt: (iso: string) => void;
  onChangePlan: (text: string) => void;
  onActionDecision: (decision: ActionDecision) => void;
  onFeedback: (
    outcome: string,
    decision: string,
    fields: { what_changed: string; difficulty: string; side_effects: string; observed_on: string; plan_text: string },
    submissionId: string,
    existing?: LifeFeedbackRead,
  ) => Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState<UserOutcome | "">("");
  const [decision, setDecision] = useState<ActionDecision | "">("");
  const [what, setWhat] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [side, setSide] = useState("");
  const [observed, setObserved] = useState("");
  const [plan, setPlan] = useState("");
  const [editing, setEditing] = useState<LifeFeedbackRead | undefined>();
  const [busy, setBusy] = useState(false);
  const submissionRef = useRef<string | undefined>(undefined);
  const fields = { what_changed: what, difficulty, side_effects: side, observed_on: observed, plan_text: plan };
  const started = action.period_start ?? action.created_at;
  const opLabel =
    op?.status === "done"
      ? t.lifeOpSynced
      : op?.status === "feedback_acked" || op?.status === "action_acked" || op?.status === "action_conflict"
        ? t.lifeOpPartial
        : op
          ? t.lifeOpOnDevice
          : null;
  return (
    <div
      id={`life-action-${action.id}`}
      className={`space-y-1 text-sm border-t pt-2 ${highlighted ? "border-indigo-500 ring-1 ring-indigo-500/30 rounded px-2" : "border-zinc-800"}`}
    >
      <div className="flex justify-between gap-2">
        <div>
          <div className="text-xs text-zinc-400">{goalName}</div>
          <CipherCard kek={kek} dek={action.encrypted_dek} ct={action.encrypted_content} fallback={action.state}>
            {(plain) => <span>{String(plain.chosen_try ?? plain.proposal ?? action.state)}</span>}
          </CipherCard>
          {action.result_metric && <div className="text-[11px] text-zinc-500">{action.result_metric}</div>}
          <div className="text-[11px] text-zinc-500">
            {t.lifeActionStarted}: {started ? started.slice(0, 10) : "—"}
            {" · "}
            {t.lifeActionDiscuss}: {action.review_at ? action.review_at.slice(0, 10) : "—"}
            {" · "}
            {action.state}
          </div>
          {action.state !== "completed" && action.state !== "stopped" && (
            <label className="block text-[11px] text-zinc-400">
              {t.lifePostpone}
              <input
                type="date"
                className="mt-1 w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs text-zinc-100"
                value={action.review_at ? action.review_at.slice(0, 10) : ""}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const zone = getAccountTimeZone();
                  onReviewAt(zonedWallTimeToUtc(e.target.value, 12, 0, zone).toISOString());
                }}
              />
            </label>
          )}
        </div>
        {badge}
      </div>
      {opLabel && <div className="text-[11px] text-amber-200">{opLabel}</div>}
      {feedback.length > 0 && <div className="text-[11px] text-zinc-400">{t.lifeFeedbackHistory}</div>}
      {feedback
        .slice()
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map((f) => {
          const plain = feedbackPlain[f.id];
          const source = outcomeSourceOf(plain);
          const shown = typeof plain?.outcome_kind === "string" ? String(plain.outcome_kind) : f.outcome_kind;
          const decision = typeof plain?.decision === "string" ? String(plain.decision) : "";
          return (
            <div key={f.id} className="text-[11px] text-zinc-400 rounded bg-zinc-950/60 border border-zinc-800 px-2 py-1">
              <div>
                {f.created_at.slice(0, 10)} · {outcomeLabel(shown, t)}
                {decision ? ` · ${decisionLabel(decision, t)}` : ""}
              </div>
              {source !== "user" && <div className="text-amber-200">{t.lifeOutcomeUnknown}</div>}
              <CipherCard kek={kek} dek={f.encrypted_dek} ct={f.encrypted_content} fallback={f.outcome_kind}>
                {(body) => (
                  <div>
                    {body.observed_on ? `${t.lifeObservedOn}: ${String(body.observed_on)} · ` : ""}
                    {String(body.what_changed ?? "")}
                    {body.difficulty ? ` · ${String(body.difficulty)}` : ""}
                  </div>
                )}
              </CipherCard>
              <button
                type="button"
                className="mt-1 text-[11px] underline text-zinc-300"
                onClick={() => {
                  setEditing(f);
                  setOutcome(source === "user" && (USER_OUTCOMES as readonly string[]).includes(shown) ? (shown as UserOutcome) : "");
                  setDecision(decision && (ACTION_DECISIONS as readonly string[]).includes(decision) ? (decision as ActionDecision) : "");
                  setWhat(typeof plain?.what_changed === "string" ? String(plain.what_changed) : "");
                  setDifficulty(typeof plain?.difficulty === "string" ? String(plain.difficulty) : "");
                  setSide(typeof plain?.side_effects === "string" ? String(plain.side_effects) : "");
                  setObserved(typeof plain?.observed_on === "string" ? String(plain.observed_on) : "");
                }}
              >
                {t.lifeCorrectOutcome}
              </button>
            </div>
          );
        })}
      <div className="space-y-1">
        <div className="flex gap-1">
          <input
            className="flex-1 rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs"
            placeholder={t.lifeChangePlan}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
          <button type="button" className="text-[11px] px-2 py-1 rounded bg-zinc-800" onClick={() => { if (plan.trim()) onChangePlan(plan.trim()); setPlan(""); }}>
            {t.save}
          </button>
        </div>
        <label className="block text-[11px] text-zinc-400">
          {t.lifeOutcome}
          <select
            autoFocus={focusResult}
            className="mt-1 w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs text-zinc-100"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as UserOutcome | "")}
          >
            <option value="">{t.lifeOutcome}</option>
            {USER_OUTCOMES.map((item) => (
              <option key={item} value={item}>
                {outcomeLabel(item, t)}
              </option>
            ))}
          </select>
        </label>
        {!editing && (
          <label className="block text-[11px] text-zinc-400">
            {t.lifeDecision}
            <select
              className="mt-1 w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs text-zinc-100"
              value={decision}
              onChange={(e) => setDecision(e.target.value as ActionDecision | "")}
            >
              <option value="">{t.lifeDecision}</option>
              {ACTION_DECISIONS.map((item) => (
                <option key={item} value={item}>
                  {decisionLabel(item, t)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-1">
          <button type="button" className="text-[11px] px-2 py-1 rounded bg-zinc-800" onClick={() => onActionDecision("continue")}>
            {t.lifeResume}
          </button>
          <button type="button" className="text-[11px] px-2 py-1 rounded bg-zinc-800" onClick={() => onActionDecision("complete")}>
            {t.lifeComplete}
          </button>
          <button type="button" className="text-[11px] px-2 py-1 rounded bg-zinc-800" onClick={() => onActionDecision("stop")}>
            {t.lifeStop}
          </button>
        </div>
        <label className="block text-[11px] text-zinc-400">
          {t.lifeObservedOn}
          <input
            type="date"
            className="mt-1 w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs"
            value={observed}
            onChange={(e) => setObserved(e.target.value)}
          />
        </label>
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs" placeholder={t.lifeWhatChanged} value={what} onChange={(e) => setWhat(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs" placeholder={t.lifeDifficulty} value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
        <input className="w-full rounded bg-zinc-950 border border-zinc-700 px-2 py-1 text-xs" placeholder={t.lifeSideEffects} value={side} onChange={(e) => setSide(e.target.value)} />
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded bg-indigo-600 disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            void (async () => {
              if (busy) return;
              const submissionId = submissionRef.current ?? crypto.randomUUID();
              submissionRef.current = submissionId;
              setBusy(true);
              try {
                const ok = await onFeedback(outcome, decision, fields, submissionId, editing);
                if (ok) {
                  setEditing(undefined);
                  setOutcome("");
                  setDecision("");
                  setWhat("");
                  setDifficulty("");
                  setSide("");
                  submissionRef.current = undefined;
                }
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy ? t.lifeSaving : editing ? t.lifeCorrectOutcome : t.lifeSaveResult}
        </button>
      </div>
      {extra}
    </div>
  );
}

function ConflictPanel({
  row,
  kek,
  t,
  onResolve,
}: {
  row: PendingLife;
  kek: CryptoKey | null;
  t: TStrings;
  onResolve: (mode: "server" | "local" | "copy") => void;
}) {
  const server = row.server_snapshot;
  return (
    <div className="rounded border border-rose-900/70 bg-rose-950/20 p-2 space-y-2 text-xs">
      <p className="text-rose-200">{t.conflictKeepBoth}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-zinc-400">{t.conflictLocal}</div>
          <CipherCard kek={kek} dek={String(row.payload.encrypted_dek ?? "")} ct={String(row.payload.encrypted_content ?? "")} fallback={row.id}>
            {(plain) => <pre className="whitespace-pre-wrap text-[11px] text-zinc-200">{JSON.stringify(plain, null, 2)}</pre>}
          </CipherCard>
        </div>
        <div>
          <div className="text-zinc-400">{t.conflictServer}</div>
          {server ? (
            <CipherCard kek={kek} dek={String(server.encrypted_dek ?? "")} ct={String(server.encrypted_content ?? "")} fallback={row.id}>
              {(plain) => <pre className="whitespace-pre-wrap text-[11px] text-zinc-200">{JSON.stringify(plain, null, 2)}</pre>}
            </CipherCard>
          ) : (
            <p className="text-zinc-500">{t.conflictServerMissing}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className="px-2 py-1 rounded bg-zinc-800" onClick={() => onResolve("server")}>
          {t.conflictKeepServer}
        </button>
        <button type="button" className="px-2 py-1 rounded bg-zinc-800" onClick={() => onResolve("copy")}>
          {t.conflictKeepLocalCopy}
        </button>
        <button type="button" className="px-2 py-1 rounded bg-indigo-600" onClick={() => onResolve("local")}>
          {t.conflictApplyLocal}
        </button>
      </div>
    </div>
  );
}
