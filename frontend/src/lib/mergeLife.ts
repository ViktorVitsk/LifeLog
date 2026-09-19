import type { LifeBundle, LifeActionRead, LifeFeedbackRead, LifeGoalRead, LifeMemoryRead } from "./api.ts";
import type { PendingLife } from "../db/offlineQueue.ts";
import { now } from "./clock.ts";

function asGoal(row: PendingLife): LifeGoalRead {
  const p = row.payload;
  return {
    id: row.id,
    state: String(p.state ?? "active"),
    review_at: (p.review_at as string | null) ?? null,
    habit_ids: (p.habit_ids as string[]) ?? [],
    skill_ids: (p.skill_ids as string[]) ?? [],
    entry_ids: (p.entry_ids as string[]) ?? [],
    encrypted_dek: String(p.encrypted_dek ?? ""),
    encrypted_content: String(p.encrypted_content ?? ""),
    version: row.server_version ?? (p.version as number | undefined),
    created_at: new Date(row.queued_at).toISOString(),
    updated_at: new Date(row.queued_at).toISOString(),
  };
}

function asMemory(row: PendingLife): LifeMemoryRead {
  const p = row.payload;
  return {
    id: row.id,
    kind: String(p.kind ?? "preference"),
    state: String(p.state ?? "proposed"),
    origin: String(p.origin ?? "user"),
    reviewed_at: (p.reviewed_at as string | null) ?? null,
    entry_ids: (p.entry_ids as string[]) ?? [],
    encrypted_dek: String(p.encrypted_dek ?? ""),
    encrypted_content: String(p.encrypted_content ?? ""),
    version: row.server_version ?? (p.version as number | undefined),
    created_at: new Date(row.queued_at).toISOString(),
    updated_at: new Date(row.queued_at).toISOString(),
  };
}

function asAction(row: PendingLife): LifeActionRead {
  const p = row.payload;
  return {
    id: row.id,
    goal_id: String(p.goal_id ?? ""),
    state: String(p.state ?? "proposed"),
    result_metric: (p.result_metric as string | null) ?? null,
    period_start: (p.period_start as string | null) ?? null,
    period_end: (p.period_end as string | null) ?? null,
    review_at: (p.review_at as string | null) ?? null,
    encrypted_dek: String(p.encrypted_dek ?? ""),
    encrypted_content: String(p.encrypted_content ?? ""),
    version: row.server_version ?? (p.version as number | undefined),
    created_at: new Date(row.queued_at).toISOString(),
    updated_at: new Date(row.queued_at).toISOString(),
  };
}

function asFeedback(row: PendingLife): LifeFeedbackRead {
  const p = row.payload;
  return {
    id: row.id,
    action_id: String(p.action_id ?? ""),
    outcome_kind: String(p.outcome_kind ?? "not_tried"),
    encrypted_dek: String(p.encrypted_dek ?? ""),
    encrypted_content: String(p.encrypted_content ?? ""),
    version: row.server_version ?? (p.version as number | undefined),
    created_at: new Date(row.queued_at).toISOString(),
    updated_at: new Date(row.queued_at).toISOString(),
  };
}

export function queueSyncLabel(status: string): "local" | "synced" | "error" | "rejected" | "conflict" {
  if (status === "synced") return "synced";
  if (status === "rejected") return "rejected";
  if (status === "conflict") return "conflict";
  if (status === "error") return "error";
  return "local";
}

export function mergeLifeBundle(
  server: LifeBundle | undefined,
  pending: PendingLife[],
  userId: string | null,
): LifeBundle {
  const empty: LifeBundle = {
    goals: [],
    memory: [],
    actions: [],
    feedback: [],
    due_action_ids: [],
  };
  const base = server ?? empty;
  const mine = pending.filter((row) => row.owner_user_id === userId);
  const hidden = new Set(mine.filter((row) => row.status === "pending_delete").map((row) => row.id));
  const overlay = mine.filter((row) => row.status !== "pending_delete" && row.status !== "synced");

  const goals = new Map(base.goals.filter((g) => !hidden.has(g.id)).map((g) => [g.id, g]));
  const memory = new Map(base.memory.filter((m) => !hidden.has(m.id)).map((m) => [m.id, m]));
  const actions = new Map(base.actions.filter((a) => !hidden.has(a.id)).map((a) => [a.id, a]));
  const feedback = new Map(base.feedback.filter((f) => !hidden.has(f.id)).map((f) => [f.id, f]));

  for (const row of overlay) {
    if (row.kind === "goal") goals.set(row.id, asGoal(row));
    if (row.kind === "memory") memory.set(row.id, asMemory(row));
    if (row.kind === "action") actions.set(row.id, asAction(row));
    if (row.kind === "feedback") feedback.set(row.id, asFeedback(row));
  }

  const actionList = [...actions.values()];
  const due = computeDueActionIds(actionList);
  return {
    goals: [...goals.values()],
    memory: [...memory.values()],
    actions: actionList,
    feedback: [...feedback.values()],
    due_action_ids: due,
  };
}

export function computeDueActionIds(
  actions: { id: string; review_at?: string | null; state?: string }[],
  at = now(),
): string[] {
  const t = at.getTime();
  return actions
    .filter(
      (a) =>
        a.review_at &&
        Date.parse(a.review_at) <= t &&
        (a.state === "accepted" || a.state === "active"),
    )
    .map((a) => a.id);
}

export function nextDueAt(
  actions: { review_at?: string | null; state?: string }[],
  at = now(),
): Date | null {
  const t = at.getTime();
  const future = actions
    .map((a) => (a.review_at && (a.state === "accepted" || a.state === "active") ? Date.parse(a.review_at) : NaN))
    .filter((ms) => Number.isFinite(ms) && ms > t)
    .sort((a, b) => a - b);
  return future[0] != null ? new Date(future[0]) : null;
}
