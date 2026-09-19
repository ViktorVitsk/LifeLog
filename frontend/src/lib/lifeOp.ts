import { captureSaveScope, type SaveScope } from "./accountScope.ts";
import { getLifeDb, type LifeOp, type PendingLife } from "../db/offlineQueue.ts";
import { getTestQueue } from "../db/testQueue.ts";
import type { LifeActionRead, LifeFeedbackRead } from "./api.ts";
import {
  actionPatchForDecision,
  assertOutcomeAndDecision,
  buildFeedbackPlain,
  intentKey,
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
  if (op.status === "feedback_acked" || op.status === "action_conflict") return "partial";
  if (feedback?.status === "synced" && (!action || action.status === "synced")) return "synced";
  if (feedback?.status === "synced" || action?.status === "synced") return "partial";
  return "on_device";
}

export async function listLifeOps(owner: string): Promise<LifeOp[]> {
  const test = getTestQueue();
  const rows = test ? [...test.ops.values()] : await getLifeDb().life_ops.toArray();
  return rows.filter((row) => row.owner_user_id === owner);
}

export async function listOpenLifeOps(owner: string): Promise<LifeOp[]> {
  return (await listLifeOps(owner)).filter((row) => row.status !== "done");
}

export async function findOpenFeedbackOp(owner: string, actionId: string): Promise<LifeOp | undefined> {
  return (await listOpenLifeOps(owner)).find((row) => row.action_id === actionId && row.kind === "feedback_and_action");
}

export async function putLifeOp(op: LifeOp): Promise<void> {
  const test = getTestQueue();
  if (test) {
    test.ops.set(op.id, op);
    return;
  }
  await getLifeDb().life_ops.put(op);
}

async function writeOpTransaction(op: LifeOp, feedback: PendingLife, action?: PendingLife): Promise<void> {
  const test = getTestQueue();
  if (test) {
    test.life.set(feedback.id, feedback);
    if (action) test.life.set(action.id, action);
    test.ops.set(op.id, op);
    return;
  }
  const store = getLifeDb();
  await store.transaction("rw", store.life_queue, store.life_ops, async () => {
    await store.life_queue.put(feedback);
    if (action) await store.life_queue.put(action);
    await store.life_ops.put(op);
  });
}

function actionLooksNewer(existing: PendingLife | undefined, expected: number | null | undefined): boolean {
  if (!existing || expected == null) return false;
  if (existing.status === "conflict") return true;
  const server = existing.server_version ?? (typeof existing.payload.version === "number" ? existing.payload.version : undefined);
  return typeof server === "number" && server > expected;
}

export async function refreshLifeOpStatus(owner: string): Promise<void> {
  for (const op of await listOpenLifeOps(owner)) {
    const feedback = await readLifeRow(op.feedback_id);
    const action = op.action_payload ? await readLifeRow(op.action_id) : undefined;
    let status = op.status;
    if (feedback?.status === "conflict" || action?.status === "conflict") status = "action_conflict";
    else if (feedback?.status === "synced" && (!op.action_payload || action?.status === "synced")) status = "done";
    else if (feedback?.status === "synced") status = "feedback_acked";
    else status = "local";
    if (status !== op.status) await putLifeOp({ ...op, status });
  }
}

export async function commitFeedbackDecision(args: {
  kek: CryptoKey;
  action: LifeActionRead;
  outcome: string;
  decision: string;
  fields: { what_changed: string; difficulty: string; side_effects: string; observed_on: string; plan_text?: string };
  existingFeedback?: LifeFeedbackRead;
  planSnapshot?: string | null;
  scope?: SaveScope;
  afterLocal?: () => Promise<void>;
}): Promise<{ op: LifeOp; reusedCipher: boolean }> {
  const { outcome, decision } = assertOutcomeAndDecision(args.outcome, args.decision);
  const scope = args.scope ?? captureSaveScope();
  const key = intentKey({
    outcome,
    decision,
    what_changed: args.fields.what_changed,
    difficulty: args.fields.difficulty,
    side_effects: args.fields.side_effects,
    observed_on: args.fields.observed_on,
    plan_text: args.fields.plan_text ?? "",
  });

  const existingOp = args.existingFeedback
    ? undefined
    : await findOpenFeedbackOp(scope.owner, args.action.id);
  const feedbackId = args.existingFeedback?.id ?? existingOp?.feedback_id ?? crypto.randomUUID();
  const opId = existingOp?.id ?? crypto.randomUUID();

  const currentAction = await readLifeRow(args.action.id);
  if (currentAction && currentAction.owner_user_id !== scope.owner) {
    throw new ActionChangedError();
  }
  if (actionLooksNewer(currentAction, args.action.version ?? existingOp?.expected_action_version)) {
    throw new ActionChangedError();
  }

  let reusedCipher = false;
  let feedbackPayload = existingOp?.feedback_payload;
  let actionPayload = existingOp?.action_payload ?? null;
  if (existingOp && existingOp.intent_key === key && existingOp.feedback_payload.encrypted_content) {
    reusedCipher = true;
    feedbackPayload = existingOp.feedback_payload;
    actionPayload = existingOp.action_payload;
  } else {
    const recordedAt = new Date().toISOString();
    const createdAt =
      typeof args.existingFeedback?.created_at === "string" ? args.existingFeedback.created_at : recordedAt;
    const blob = await encryptLifePayload(
      args.kek,
      buildFeedbackPlain({
        outcome: outcome as UserOutcome,
        decision: decision as ActionDecision,
        what_changed: args.fields.what_changed,
        difficulty: args.fields.difficulty,
        side_effects: args.fields.side_effects,
        observed_on: args.fields.observed_on,
        recorded_at: recordedAt,
        created_at: createdAt,
        action_id: args.action.id,
        action_version: args.action.version ?? null,
        plan_snapshot: args.planSnapshot ?? (args.fields.plan_text?.trim() || null),
      }),
      { scope },
    );
    if (scope.owner !== (args.scope ?? scope).owner) {
      throw new Error("account_scope_changed");
    }
    feedbackPayload = {
      id: feedbackId,
      action_id: args.action.id,
      outcome_kind: outcome,
      encrypted_dek: blob.encrypted_dek,
      encrypted_content: blob.encrypted_content,
      version: args.existingFeedback?.version,
    };
    let extra: { encrypted_dek?: string; encrypted_content?: string } | undefined;
    if (decision === "change_plan" && args.fields.plan_text?.trim()) {
      const plan = await encryptLifePayload(
        args.kek,
        { proposal: args.fields.plan_text.trim(), chosen_try: args.fields.plan_text.trim(), grounds: "" },
        { scope },
      );
      extra = { encrypted_dek: plan.encrypted_dek, encrypted_content: plan.encrypted_content };
    }
    const patch = actionPatchForDecision(decision as ActionDecision, args.action.state, extra);
    actionPayload = {
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
      ...patch,
    };
  }

  const feedbackRow = nextLifeEnqueue(await readLifeRow(feedbackId), "feedback", feedbackPayload!, scope.owner);
  const actionRow = actionPayload
    ? nextLifeEnqueue(await readLifeRow(args.action.id), "action", actionPayload, scope.owner)
    : undefined;
  const op: LifeOp = {
    id: opId,
    owner_user_id: scope.owner,
    session_id: scope.sessionId,
    kind: "feedback_and_action",
    status: "local",
    feedback_id: feedbackId,
    action_id: args.action.id,
    expected_action_version: args.action.version ?? existingOp?.expected_action_version ?? null,
    intent_key: key,
    feedback_payload: feedbackPayload!,
    action_payload: actionPayload,
    created_at: existingOp?.created_at ?? Date.now(),
  };
  await writeOpTransaction(op, feedbackRow, actionRow);
  if (args.afterLocal) await args.afterLocal();
  return { op, reusedCipher };
}

export async function resumeFeedbackOps(owner: string): Promise<void> {
  await refreshLifeOpStatus(owner);
}
