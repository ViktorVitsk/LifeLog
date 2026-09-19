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

export class FeedbackChangedError extends Error {
  constructor() {
    super("feedback_changed");
    this.name = "FeedbackChangedError";
  }
}

export class SubmissionReusedError extends Error {
  constructor() {
    super("submission_id_already_used");
    this.name = "SubmissionReusedError";
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

async function readOp(id: string, store?: LifeLogDB): Promise<LifeOp | undefined> {
  const { test, db } = resolveQueueAccess(store);
  if (test) return test.ops.get(id);
  return db?.life_ops.get(id);
}

function actionLooksNewer(existing: PendingLife | undefined, expectedVersion: number | null | undefined, expectedLocalRev?: number | null): boolean {
  if (!existing) return false;
  if (existing.status === "conflict") return true;
  const server = existing.server_version ?? (typeof existing.payload.version === "number" ? existing.payload.version : undefined);
  if (typeof server === "number" && expectedVersion != null && server > expectedVersion) return true;
  if (expectedLocalRev != null && (existing.local_rev ?? 0) > expectedLocalRev) return true;
  return false;
}

function feedbackLooksNewer(
  existing: PendingLife,
  expectedVersion: number | null | undefined,
  expectedLocalRev?: number | null,
): boolean {
  if (existing.status === "conflict") return true;
  const server = existing.server_version ?? (typeof existing.payload.version === "number" ? existing.payload.version : undefined);
  if (typeof server === "number" && expectedVersion != null && server > expectedVersion) return true;
  if (expectedLocalRev != null && (existing.local_rev ?? 0) > expectedLocalRev) return true;
  return false;
}

function assertFeedbackSnapshot(
  current: PendingLife | undefined,
  expected: { owner: string; actionId: string; expectedVersion: number | null; expectedLocalRev: number | null },
): PendingLife {
  if (!current || current.status === "pending_delete" || current.payload.deleted) {
    throw new FeedbackChangedError();
  }
  if (current.owner_user_id !== expected.owner) throw new FeedbackChangedError();
  const actionId = current.payload.action_id;
  if (actionId && String(actionId) !== expected.actionId) throw new FeedbackChangedError();
  if (feedbackLooksNewer(current, expected.expectedVersion, expected.expectedLocalRev)) {
    throw new FeedbackChangedError();
  }
  return current;
}

function entityMatchesOp(
  row: PendingLife | undefined,
  expectedRev: number | null | undefined,
  opPayload: Record<string, unknown> | null | undefined,
): boolean {
  if (!row || expectedRev == null || row.local_rev !== expectedRev) return false;
  const opCipher = cipherOf(opPayload);
  if (opCipher) {
    const rowCipher = cipherOf(row.payload);
    if (rowCipher && rowCipher !== opCipher) return false;
  }
  return true;
}

export function recoverLegacyOpRevs(op: LifeOp, feedback?: PendingLife, action?: PendingLife): LifeOp {
  const next = { ...op };
  if (next.feedback_local_rev == null && feedback) {
    const opCipher = cipherOf(op.feedback_payload);
    const rowCipher = cipherOf(feedback.payload);
    if (opCipher && rowCipher && opCipher === rowCipher) {
      next.feedback_local_rev = feedback.local_rev ?? 1;
    }
  }
  if (next.kind === "feedback_and_action" && next.action_local_rev == null && action) {
    const opCipher = cipherOf(op.action_payload);
    const rowCipher = cipherOf(action.payload);
    if (opCipher && rowCipher && opCipher === rowCipher) {
      next.action_local_rev = action.local_rev ?? 1;
    }
  }
  return next;
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
  for (const listed of await listOpenLifeOps(owner, store)) {
    const op = await readOp(listed.id, store);
    if (!op || op.status === "done" || op.status === "superseded") continue;
    if ((op.status_seq ?? 0) !== (listed.status_seq ?? 0)) continue;

    const feedback = await readLifeRow(op.feedback_id, store);
    const action = op.kind === "feedback_and_action" ? await readLifeRow(op.action_id, store) : undefined;
    let next = recoverLegacyOpRevs(op, feedback, action);
    const fbConflict =
      feedback?.status === "conflict" &&
      next.feedback_local_rev != null &&
      feedback.local_rev === next.feedback_local_rev;
    const actConflict =
      action?.status === "conflict" &&
      next.action_local_rev != null &&
      action.local_rev === next.action_local_rev;

    if (fbConflict || actConflict) {
      next = { ...next, status: "action_conflict" };
    } else {
      if (next.status === "action_conflict") {
        if (action && action.status !== "conflict" && (action.local_rev ?? 0) > (next.action_local_rev ?? 0)) {
          next = {
            ...next,
            action_local_rev: action.local_rev,
            action_acked: action.status === "synced" && entityMatchesOp(action, action.local_rev, next.action_payload),
          };
        }
        if (feedback && feedback.status !== "conflict" && (feedback.local_rev ?? 0) > (next.feedback_local_rev ?? 0)) {
          next = {
            ...next,
            feedback_local_rev: feedback.local_rev,
            feedback_acked: feedback.status === "synced" && entityMatchesOp(feedback, feedback.local_rev, next.feedback_payload),
          };
        }
      }
      next = { ...next, status: next.status === "action_conflict" ? "local" : next.status };
      if (feedback?.status === "synced" && entityMatchesOp(feedback, next.feedback_local_rev, next.feedback_payload)) {
        next.feedback_acked = true;
      }
      if (action?.status === "synced" && entityMatchesOp(action, next.action_local_rev, next.action_payload)) {
        next.action_acked = true;
      }
      next = finalizeLifeOpStatus(next);
    }

    const latest = await readOp(op.id, store);
    if (!latest || latest.status === "done" || latest.status === "superseded") continue;
    if ((latest.status_seq ?? 0) !== (op.status_seq ?? 0)) continue;
    if (
      next.status === latest.status &&
      next.feedback_acked === latest.feedback_acked &&
      next.action_acked === latest.action_acked &&
      next.feedback_payload === latest.feedback_payload &&
      next.action_payload === latest.action_payload &&
      next.feedback_local_rev === latest.feedback_local_rev &&
      next.action_local_rev === latest.action_local_rev
    ) {
      continue;
    }
    await putLifeOp(stripDoneOpPayloads({ ...next, status_seq: (latest.status_seq ?? 0) + 1 }), store);
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
  expectedFeedbackVersion?: number | null;
  expectedFeedbackLocalRev?: number | null;
}

async function prepareFeedbackCipher(
  args: CommitCommon & { outcome: UserOutcome; decision: ActionDecision; existingOp?: LifeOp; createdAt?: string; recordedAt?: string; actionVersion?: number | null; correctedAt?: string },
): Promise<{ payload: Record<string, unknown>; reusedCipher: boolean; hadExisting: boolean }> {
  const lockToExisting = Boolean(args.existingOp?.id && args.existingOp.submission_id);
  const hadExisting = Boolean(args.existingOp?.feedback_payload && cipherOf(args.existingOp.feedback_payload));
  if (hadExisting) {
    const plain = await decryptPayload(args.kek, args.existingOp?.feedback_payload);
    if (plain && sameFeedbackIntent(plain, args)) {
      return { payload: args.existingOp!.feedback_payload!, reusedCipher: true, hadExisting };
    }
    if (lockToExisting) throw new SubmissionReusedError();
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
  if (existingOp?.status === "done") {
    return { op: existingOp, reusedCipher: true };
  }

  let actionExtra: { encrypted_dek?: string; encrypted_content?: string } | undefined;
  const prepared = await prepareFeedbackCipher({
    ...args,
    outcome,
    decision,
    scope,
    existingOp,
    planSnapshot: args.planSnapshot ?? (args.fields.plan_text?.trim() || null),
  });
  if (decision === "change_plan" && args.fields.plan_text?.trim() && !prepared.reusedCipher) {
    const plan = await encryptLifePayload(args.kek, { proposal: args.fields.plan_text.trim(), chosen_try: args.fields.plan_text.trim(), grounds: "" }, { scope });
    actionExtra = { encrypted_dek: plan.encrypted_dek, encrypted_content: plan.encrypted_content };
  }
  if (args.afterEncrypt) await args.afterEncrypt();

  const result = await runWriteTx(args.store, async () => {
    const inTx = await findOpBySubmission(scope.owner, submissionId, args.store);
    if (inTx?.status === "done") {
      return { op: inTx, reusedCipher: true };
    }
    if (inTx && inTx.status !== "superseded") {
      if (!prepared.hadExisting || prepared.reusedCipher) {
        return { op: inTx, reusedCipher: true };
      }
      throw new SubmissionReusedError();
    }
    const currentAction = await readActionInTx(args.action.id, args.store);
    if (currentAction && currentAction.owner_user_id !== scope.owner) throw new ActionChangedError();
    if (actionLooksNewer(currentAction, expectedVersion, expectedLocalRev)) throw new ActionChangedError();

    const feedbackId = String(prepared.payload.id);
    const opId = inTx?.id ?? existingOp?.id ?? crypto.randomUUID();
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
      if (
        other.kind === "feedback_and_action" &&
        other.action_id === args.action.id &&
        other.submission_id !== submissionId &&
        other.id !== opId
      ) {
        await putLifeOp({ ...other, status: "superseded", status_seq: (other.status_seq ?? 0) + 1 }, args.store);
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
      created_at: inTx?.created_at ?? existingOp?.created_at ?? Date.now(),
      status_seq: (inTx?.status_seq ?? existingOp?.status_seq ?? 0) + 1,
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
  if (args.existingFeedback.action_id && args.existingFeedback.action_id !== args.action.id) {
    throw new FeedbackChangedError();
  }
  const existingOp = await findOpBySubmission(scope.owner, submissionId, args.store);
  if (existingOp?.status === "done") {
    return { op: existingOp, reusedCipher: true };
  }
  const expectedFeedbackVersion = args.expectedFeedbackVersion ?? args.existingFeedback.version ?? null;
  const currentFbBefore = await readLifeRow(args.existingFeedback.id, args.store);
  const expectedFeedbackLocalRev = args.expectedFeedbackLocalRev ?? currentFbBefore?.local_rev ?? 0;
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
    existingOp: existingOp && existingOp.status !== "done" ? existingOp : undefined,
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
  prepared.payload.version = expectedFeedbackVersion ?? args.existingFeedback.version;
  if (args.afterEncrypt) await args.afterEncrypt();

  const result = await runWriteTx(args.store, async () => {
    const inTx = await findOpBySubmission(scope.owner, submissionId, args.store);
    if (inTx?.status === "done") {
      return { op: inTx, reusedCipher: true };
    }
    if (inTx && inTx.status !== "superseded") {
      if (!prepared.hadExisting || prepared.reusedCipher) {
        return { op: inTx, reusedCipher: true };
      }
      throw new SubmissionReusedError();
    }
    const currentAction = await readActionInTx(args.action.id, args.store);
    if (currentAction && currentAction.owner_user_id !== scope.owner) throw new ActionChangedError();
    const feedbackId = args.existingFeedback.id;
    const currentFb = assertFeedbackSnapshot(await readLifeRow(feedbackId, args.store), {
      owner: scope.owner,
      actionId: args.action.id,
      expectedVersion: expectedFeedbackVersion,
      expectedLocalRev: expectedFeedbackLocalRev,
    });
    const opId = inTx?.id ?? existingOp?.id ?? crypto.randomUUID();
    const feedbackRow = nextLifeEnqueue(currentFb, "feedback", prepared.payload, scope.owner);
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
      created_at: inTx?.created_at ?? existingOp?.created_at ?? Date.now(),
      status_seq: (inTx?.status_seq ?? existingOp?.status_seq ?? 0) + 1,
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
