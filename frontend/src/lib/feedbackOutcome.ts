export const USER_OUTCOMES = [
  "not_tried",
  "tried_no_effect",
  "tried_helped",
  "not_suitable",
  "unevaluated",
] as const;

export const LEGACY_OUTCOMES = ["tried_hurt", "other"] as const;

export type UserOutcome = (typeof USER_OUTCOMES)[number];
export type FeedbackOutcomeKind = UserOutcome | (typeof LEGACY_OUTCOMES)[number] | string;

export const ACTION_DECISIONS = ["continue", "change_plan", "complete", "stop"] as const;
export type ActionDecision = (typeof ACTION_DECISIONS)[number];

export type OutcomeSource = "user" | "unknown";

export function isUserOutcome(value: string): value is UserOutcome {
  return (USER_OUTCOMES as readonly string[]).includes(value);
}

export function isActionDecision(value: string): value is ActionDecision {
  return (ACTION_DECISIONS as readonly string[]).includes(value);
}

/** Tried follows the chosen result. Stopping is a decision, not “no benefit”. */
export function triedFromOutcome(outcome: string): boolean {
  return outcome !== "not_tried";
}

export function outcomeSourceOf(plain: Record<string, unknown> | undefined): OutcomeSource {
  if (plain?.outcome_source === "user" && typeof plain.outcome_kind === "string" && isUserOutcome(plain.outcome_kind)) {
    return "user";
  }
  return "unknown";
}

export function decisionOf(plain: Record<string, unknown> | undefined): ActionDecision | undefined {
  return typeof plain?.decision === "string" && isActionDecision(plain.decision) ? plain.decision : undefined;
}

export function intentKey(input: {
  outcome: string;
  decision: ActionDecision;
  what_changed: string;
  difficulty: string;
  side_effects: string;
  observed_on: string;
  plan_text: string;
}): string {
  return JSON.stringify({
    outcome: input.outcome,
    decision: input.decision,
    what_changed: input.what_changed.trim(),
    difficulty: input.difficulty.trim(),
    side_effects: input.side_effects.trim(),
    observed_on: input.observed_on.trim(),
    plan_text: input.plan_text.trim(),
  });
}

export function buildFeedbackPlain(input: {
  outcome: UserOutcome;
  decision: ActionDecision;
  what_changed: string;
  difficulty: string;
  side_effects: string;
  observed_on: string;
  recorded_at: string;
  action_id: string;
  action_version?: number | null;
  plan_snapshot?: string | null;
  created_at?: string | null;
}): Record<string, unknown> {
  return {
    outcome_kind: input.outcome,
    outcome_source: "user",
    decision: input.decision,
    tried: triedFromOutcome(input.outcome),
    what_changed: input.what_changed.trim(),
    difficulty: input.difficulty.trim(),
    side_effects: input.side_effects.trim(),
    observed_on: input.observed_on.trim() || null,
    recorded_at: input.recorded_at,
    created_at: input.created_at ?? input.recorded_at,
    action_id: input.action_id,
    action_version: input.action_version ?? null,
    plan_snapshot: input.plan_snapshot ?? null,
  };
}

export function actionPatchForDecision(
  decision: ActionDecision,
  currentState: string,
  extra?: { encrypted_dek?: string; encrypted_content?: string },
): Record<string, unknown> {
  const keep =
    currentState === "accepted" || currentState === "active" ? currentState : "accepted";
  if (decision === "complete") return { state: "completed", review_at: null, ...extra };
  if (decision === "stop") return { state: "stopped", review_at: null, ...extra };
  return { state: keep, ...extra };
}

export function assertOutcomeAndDecision(outcome: string, decision: string): {
  outcome: UserOutcome;
  decision: ActionDecision;
} {
  if (!isUserOutcome(outcome)) throw new Error("outcome_required");
  if (!isActionDecision(decision)) throw new Error("decision_required");
  return { outcome, decision };
}
