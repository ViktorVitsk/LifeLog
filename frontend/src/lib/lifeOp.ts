import { captureSaveScope, type SaveScope } from "./accountScope.ts";
import { decryptEntry } from "./crypto.ts";
import {
  finalizeLifeOpStatus,
  resolveQueueAccess,
  stripDoneOpPayloads,
  type LifeLogDB,
  type LifeOp,
  type LifeOpKind,
  type PendingLife,
} from "../db/offlineQueue.ts";
import type { LifeActionRead, LifeFeedbackRead } from "./api.ts";
import {
  actionPatchForDecision,
  assertOutcome,
  assertOutcomeAndDecision,
  buildFeedbackPlain,
  type ActionDecision,
  type UserOutcome,
} from "./feedbackOutcome.ts";
import { encryptLifePayload, nextLifeEnqueue, readLifeRow } from "./lifeQueue.ts";

export class ActionChangedError extends Error {
  constructor() {
    super("action_changed_remotely");
    this.name = "ActionChangedError";
  }
}

export function opDeliveryLabel(op: LifeOp, feedback?: PendingLife, action?: PendingLife): "on_device" | "partial" | "synced" {
  if (op.status === "done") return "synced";
  if (op.status === "feedback_acked" || op.status === "action_acked" || op.status === "action_conflict") return "partial";
  if (feedback?.status === "synced" && feedback.local_rev === op.feedback_local_rev && (!op.action_local_rev || (action?.status === "synced" && action.local_rev === op.action_local_rev))) {
    return "synced";
  }
  if (
    (feedback?.status === "synced" && feedback.local_rev === op.feedback_local_rev) ||
    (action?.status === "synced" && action.local_rev === op.action_local_rev)
  ) {
    return "partial";
  }
  return "on_device";
}

async function listOps(owner: string, store?: LifeLogDB): Promise<LifeOp[]> {
  const { test, db } = resolveQueueAccess(store);
  const rows = test ? [...test.ops.values()] : db ? await db.life_ops.toArray() : [];
  return rows.filter((row) => row.owner_user_id === owner);
}

export async function listLifeOps(owner: string, store?: LifeLogDB): Promise<LifeOp[]> {
  return listOps(owner, store);
}

export async function listOpenLifeOps(owner: string, store?: LifeLogDB): Promise<LifeOp[]> {
  return (await listOps(owner, store)).filter((row) => row.status !== "done" && row.status !== "superseded");
}

export async function findOpenFeedbackOp(owner: string, actionId: string, store?: LifeLogDB): Promise<LifeOp | undefined> {
  return (await listOpenLifeOps(owner, store)).find((row) => row.action_id === actionId && row.kind === "feedback_and_action");
}

export async function findOpBySubmission(owner: string, submissionId: string, store?: LifeLogDB): Promise<LifeOp | undefined> {
  return (await listOps(owner, store)).find((row) => row.submission_id === submissionId && row.status !== "superseded");
}

export async function putLifeOp(op: LifeOp, store?: LifeLogDB): Promise<void> {
  const { test, db } = resolveQueueAccess(store);
  if (test) {
    test.ops.set(op.id, op);
    return;
  }
  if (db) await db.life_ops.put(op);
}

function actionLooksNewer(existing: PendingLife | undefined, expectedVersion: number | null | undefined, expectedLocalRev?: number | null): boolean {
  if (!existing) return false;
  if (existing.status === "conflict") return true;
  const server = existing.server_version ?? (typeof existing.payload.version === "number" ? existing.payload.version : undefined);
  if (typeof server === "number" && expectedVersion != null && server > expectedVersion) return true;
  if (expectedLocalRev != null && (existing.local_rev ?? 0) > expectedLocalRev) return true;
  return false;
}

function cipherOf(payload: Record<string, unknown> | null | undefined): string {
  return typeof payload?.encrypted_content === "string" ? payload.encrypted_content : "";
}

async function decryptPayload(kek: CryptoKey, payload: Record<string, unknown> | null | undefined): Promise<Record<string, unknown> | undefined> {
  const ct = typeof payload?.encrypted_content === "string" ? payload.encrypted_content : "";
  const dek = typeof payload?.encrypted_dek === "string" ? payload.encrypted_dek : "";
  if (!ct || !dek) return undefined;
  try {
    return JSON.parse(await decryptEntry(ct, dek, kek)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function sameFeedbackIntent(
  plain: Record<string, unknown>,
  args: {
    outcome: string;
    decision: string;
    fields: { what_changed: string; difficulty: string; side_effects: string; observed_on: string; plan_text?: string };
    planSnapshot?: string | null;
  },
): boolean {
  const plan = args.planSnapshot ?? args.fields.plan_text?.trim() ?? "";
  return (
    String(plain.outcome_kind ?? "") === args.outcome &&
    String(plain.decision ?? "") === args.decision &&
    String(plain.what_changed ?? "") === args.fields.what_changed.trim() &&
    String(plain.difficulty ?? "") === args.fields.difficulty.trim() &&
    String(plain.side_effects ?? "") === args.fields.side_effects.trim() &&
    String(plain.observed_on ?? "") === args.fields.observed_on.trim() &&
    String(plain.plan_snapshot ?? "") === plan
  );
}

async function runWriteTx<T>(store: LifeLogDB | undefined, fn: () => Promise<T>): Promise<T> {
  const { test, db } = resolveQueueAccess(store);
  if (test) return test.runTx(fn);
  if (!db) return fn();
  return db.transaction("rw", db.life_queue, db.life_ops, fn);
}

async function readActionInTx(id: string, store?: LifeLogDB): Promise<PendingLife | undefined> {
  return readLifeRow(id, store);
}

async function writeRows(op: LifeOp, feedback: PendingLife, action: PendingLife | undefined, store?: LifeLogDB): Promise<void> {
  const { test, db } = resolveQueueAccess(store);
  if (test) {
    test.life.set(feedback.id, feedback);
    if (action) test.life.set(action.id, action);
    test.ops.set(op.id, op);
    return;
  }
  if (!db) return;
  await db.life_queue.put(feedback);
  if (action) await db.life_queue.put(action);
  await db.life_ops.put(op);
}

export async function refreshLifeOpStatus(owner: string, store?: LifeLogDB): Promise<void> {
  for (const op of await listOpenLifeOps(owner, store)) {
    const feedback = await readLifeRow(op.feedback_id, store);
    const action = op.action_local_rev != null ? await readLifeRow(op.action_id, store) : undefined;
    let next = { ...op };
    if (
      (feedback?.status === "conflict" && feedback.local_rev === op.feedback_local_rev) ||
      (action?.status === "conflict" && action.local_rev === op.action_local_rev)
    ) {
      next.status = "action_conflict";
    } else {
      if (feedback?.status === "synced" && feedback.local_rev === op.feedback_local_rev) next.feedback_acked = true;
      if (action?.status === "synced" && action.local_rev === op.action_local_rev) next.action_acked = true;
      next = finalizeLifeOpStatus(next);
    }
    if (
      next.status !== op.status ||
      next.feedback_acked !== op.feedback_acked ||
      next.action_acked !== op.action_acked ||
      next.feedback_payload !== op.feedback_payload
    ) {
      await putLifeOp(stripDoneOpPayloads(next), store);
    }
  }
}

interface CommitCommon {
  kek: CryptoKey;
  action: LifeActionRead;
  fields: { what_changed: string; difficulty: string; side_effects: string; observed_on: string; plan_text?: string };
  submissionId: string;
  planSnapshot?: string | null;
  scope?: SaveScope;
  afterEncrypt?: () => Promise<void>;
  afterLocal?: () => Promise<void>;
  store?: LifeLogDB;
}

async function prepareFeedbackCipher(
  args: CommitCommon & { outcome: UserOutcome; decision: ActionDecision; existingOp?: LifeOp; createdAt?: string; recordedAt?: string; actionVersion?: number | null; correctedAt?: string },
): Promise<{ payload: Record<string, unknown>; reusedCipher: boolean; hadExisting: boolean }> {
  const hadExisting = Boolean(args.existingOp?.feedback_payload && cipherOf(args.existingOp.feedback_payload));
  if (hadExisting) {
    const plain = await decryptPayload(args.kek, args.existingOp?.feedback_payload);
    if (plain && sameFeedbackIntent(plain, args)) {
      return { payload: args.existingOp!.feedback_payload!, reusedCipher: true, hadExisting };
    }
  }
  const recordedAt = args.recordedAt ?? new Date().toISOString();
  const createdAt = args.createdAt ?? recordedAt;
  const blob = await encryptLifePayload(
    args.kek,
    buildFeedbackPlain({
      outcome: args.outcome,
      decision: args.decision,
      what_changed: args.fields.what_changed,
      difficulty: args.fields.difficulty,
      side_effects: args.fields.side_effects,
      observed_on: args.fields.observed_on,
      recorded_at: recordedAt,
      created_at: createdAt,
      action_id: args.action.id,
      action_version: args.actionVersion ?? args.action.version ?? null,
      plan_snapshot: args.planSnapshot ?? (args.fields.plan_text?.trim() || null),
      corrected_at: args.correctedAt,
    }),
    { scope: args.scope },
  );
  const existingId = args.existingOp?.feedback_id;
  return {
    reusedCipher: false,
    hadExisting,
    payload: {
      id: existingId ?? crypto.randomUUID(),
      action_id: args.action.id,
      outcome_kind: args.outcome,
      encrypted_dek: blob.encrypted_dek,
      encrypted_content: blob.encrypted_content,
      version: undefined as number | undefined,
    },
  };
}

export async function commitFeedbackDecision(args: CommitCommon & {
  outcome: string;
  decision: string;
}): Promise<{ op: LifeOp; reusedCipher: boolean }> {
  const { outcome, decision } = assertOutcomeAndDecision(args.outcome, args.decision);
  const scope = args.scope ?? captureSaveScope();
  const submissionId = args.submissionId;
  const expectedVersion = args.action.version ?? null;
  const currentBefore = await readLifeRow(args.action.id, args.store);
  const expectedLocalRev = currentBefore?.local_rev ?? 0;
  const existingOp = await findOpBySubmission(scope.owner, submissionId, args.store);
  const existingOpen = existingOp && existingOp.status !== "done" ? existingOp : undefined;

  let actionExtra: { encrypted_dek?: string; encrypted_content?: string } | undefined;
  const prepared = await prepareFeedbackCipher({
    ...args,
    outcome,
    decision,
    scope,
    existingOp: existingOpen,
    planSnapshot: args.planSnapshot ?? (args.fields.plan_text?.trim() || null),
  });
  if (decision === "change_plan" && args.fields.plan_text?.trim() && !prepared.reusedCipher) {
    const plan = await encryptLifePayload(args.kek, { proposal: args.fields.plan_text.trim(), chosen_try: args.fields.plan_text.trim(), grounds: "" }, { scope });
    actionExtra = { encrypted_dek: plan.encrypted_dek, encrypted_content: plan.encrypted_content };
  }
  if (args.afterEncrypt) await args.afterEncrypt();

  const result = await runWriteTx(args.store, async () => {
    const inTx = await findOpBySubmission(scope.owner, submissionId, args.store);
    if (inTx && inTx.status !== "done" && (!prepared.hadExisting || prepared.reusedCipher)) {
      return { op: inTx, reusedCipher: true };
    }
    const currentAction = await readActionInTx(args.action.id, args.store);
    if (currentAction && currentAction.owner_user_id !== scope.owner) throw new ActionChangedError();
    if (actionLooksNewer(currentAction, expectedVersion, expectedLocalRev)) throw new ActionChangedError();

    const feedbackId = String(prepared.payload.id);
    const opId = inTx?.id ?? existingOpen?.id ?? crypto.randomUUID();
    const actionPayload = {
      id: args.action.id,
      goal_id: args.action.goal_id,
      state: args.action.state,
      result_metric: args.action.result_metric ?? null,
      period_start: args.action.period_start ?? null,
      period_end: args.action.period_end ?? null,
      review_at: args.action.review_at ?? null,
      encrypted_dek: args.action.encrypted_dek,
      encrypted_content: args.action.encrypted_content,
      version: args.action.version,
      ...actionPatchForDecision(decision, args.action.state, actionExtra),
    };
    const feedbackRow = nextLifeEnqueue(await readLifeRow(feedbackId, args.store), "feedback", prepared.payload, scope.owner);
    const actionRow = nextLifeEnqueue(await readLifeRow(args.action.id, args.store), "action", actionPayload, scope.owner);
    for (const other of await listOpenLifeOps(scope.owner, args.store)) {
      if (other.action_id === args.action.id && other.submission_id !== submissionId && other.id !== opId) {
        await putLifeOp({ ...other, status: "superseded" }, args.store);
      }
    }
    const op: LifeOp = {
      id: opId,
      owner_user_id: scope.owner,
      session_id: scope.sessionId,
      kind: "feedback_and_action",
      status: "local",
      submission_id: submissionId,
      feedback_id: feedbackId,
      action_id: args.action.id,
      expected_action_version: expectedVersion,
      expected_action_local_rev: expectedLocalRev,
      feedback_local_rev: feedbackRow.local_rev,
      action_local_rev: actionRow.local_rev,
      feedback_acked: false,
      action_acked: false,
      feedback_payload: prepared.payload,
      action_payload: actionPayload,
      created_at: inTx?.created_at ?? existingOpen?.created_at ?? Date.now(),
    };
    await writeRows(op, feedbackRow, actionRow, args.store);
    return { op, reusedCipher: prepared.reusedCipher };
  });
  if (args.afterLocal) await args.afterLocal();
  return result;
}

export async function commitFeedbackCorrection(args: CommitCommon & {
  outcome: string;
  existingFeedback: LifeFeedbackRead;
  existingPlain?: Record<string, unknown>;
}): Promise<{ op: LifeOp; reusedCipher: boolean }> {
  const outcome = assertOutcome(args.outcome);
  const scope = args.scope ?? captureSaveScope();
  const submissionId = args.submissionId;
  const existingOp = await findOpBySubmission(scope.owner, submissionId, args.store);
  const existingOpen = existingOp && existingOp.status !== "done" ? existingOp : undefined;
  const existingPlain = args.existingPlain ?? (await decryptPayload(args.kek, {
    encrypted_content: args.existingFeedback.encrypted_content,
    encrypted_dek: args.existingFeedback.encrypted_dek,
  }));
  const decision =
    typeof existingPlain?.decision === "string" ? (existingPlain.decision as ActionDecision) : "continue";
  const observedOn = args.fields.observed_on.trim() || String(existingPlain?.observed_on ?? "");
  const planSnapshot =
    args.planSnapshot ??
    (typeof existingPlain?.plan_snapshot === "string" ? existingPlain.plan_snapshot : null);
  const prepared = await prepareFeedbackCipher({
    ...args,
    outcome,
    decision,
    scope,
    existingOp: existingOpen ?? {
      id: existingOp?.id ?? "",
      owner_user_id: scope.owner,
      session_id: scope.sessionId,
      kind: "feedback_correction",
      status: "local",
      submission_id: submissionId,
      feedback_id: args.existingFeedback.id,
      action_id: args.action.id,
      feedback_payload: {
        id: args.existingFeedback.id,
        encrypted_content: args.existingFeedback.encrypted_content,
        encrypted_dek: args.existingFeedback.encrypted_dek,
      },
      created_at: Date.now(),
    },
    createdAt: typeof existingPlain?.created_at === "string" ? existingPlain.created_at : args.existingFeedback.created_at,
    recordedAt: typeof existingPlain?.recorded_at === "string" ? existingPlain.recorded_at : undefined,
    actionVersion:
      typeof existingPlain?.action_version === "number"
        ? existingPlain.action_version
        : args.existingFeedback.version ?? args.action.version ?? null,
    planSnapshot,
    fields: { ...args.fields, observed_on: observedOn },
    correctedAt: new Date().toISOString(),
  });
  prepared.payload.id = args.existingFeedback.id;
  prepared.payload.version = args.existingFeedback.version;
  if (args.afterEncrypt) await args.afterEncrypt();

  const result = await runWriteTx(args.store, async () => {
    const inTx = await findOpBySubmission(scope.owner, submissionId, args.store);
    if (inTx && inTx.status !== "done" && (!prepared.hadExisting || prepared.reusedCipher)) {
      return { op: inTx, reusedCipher: true };
    }
    const currentAction = await readActionInTx(args.action.id, args.store);
    if (currentAction && currentAction.owner_user_id !== scope.owner) throw new ActionChangedError();
    const feedbackId = args.existingFeedback.id;
    const opId = inTx?.id ?? existingOpen?.id ?? crypto.randomUUID();
    const feedbackRow = nextLifeEnqueue(await readLifeRow(feedbackId, args.store), "feedback", prepared.payload, scope.owner);
    const op: LifeOp = {
      id: opId,
      owner_user_id: scope.owner,
      session_id: scope.sessionId,
      kind: "feedback_correction",
      status: "local",
      submission_id: submissionId,
      feedback_id: feedbackId,
      action_id: args.action.id,
      expected_action_version: args.action.version ?? null,
      feedback_local_rev: feedbackRow.local_rev,
      action_local_rev: null,
      feedback_acked: false,
      action_acked: false,
      feedback_payload: prepared.payload,
      action_payload: null,
      created_at: inTx?.created_at ?? existingOpen?.created_at ?? Date.now(),
    };
    await writeRows(op, feedbackRow, undefined, args.store);
    return { op, reusedCipher: prepared.reusedCipher };
  });
  if (args.afterLocal) await args.afterLocal();
  return result;
}

export async function resumeFeedbackOps(owner: string, store?: LifeLogDB): Promise<void> {
  await refreshLifeOpStatus(owner, store);
}

export type { LifeOpKind };
