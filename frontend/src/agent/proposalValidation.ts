import { ENTRY_TYPES, type EntryTypeName, type ProposedEntry, type Provenance } from "./types.ts";

export interface FieldIssue {
  field: string;
  message: string;
}

const SCORE_FIELDS = [
  "mood_score",
  "energy_score",
  "anxiety_score",
  "focus_score",
  "social_battery_score",
  "stress_score",
  "sleep_quality",
  "resentment_score",
  "guilt_score",
  "shame_score",
  "fear_score",
] as const;

const NUMBER_FIELDS: Record<string, { min: number; max: number; integer?: boolean }> = {
  sleep_hours: { min: 0, max: 24 },
  session_duration_min: { min: 0, max: 24 * 60 },
  habit_value: { min: -1e6, max: 1e6 },
  weight_kg: { min: 0, max: 500 },
  body_fat_pct: { min: 0, max: 100 },
  waist_cm: { min: 0, max: 500 },
  resting_hr: { min: 0, max: 300 },
  calories_estimate: { min: 0, max: 20000 },
  protein_estimate: { min: 0, max: 1000 },
  dose: { min: 0, max: 1e6 },
  progress_pct: { min: 0, max: 100 },
};

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

export function isEntryType(v: unknown): v is EntryTypeName {
  return typeof v === "string" && (ENTRY_TYPES as readonly string[]).includes(v);
}

export function provenanceOf(v: unknown): Provenance {
  if (v === "user_stated" || v === "agent_extracted" || v === "agent_inferred") return v;
  return "agent_extracted";
}

function missing(v: unknown): boolean {
  return v == null || v === "";
}

export function parseOptionalScore(v: unknown, field: string): { value: number | null; issue?: FieldIssue } {
  if (missing(v)) return { value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    return { value: null, issue: { field, message: "not_a_number" } };
  }
  if (n < SCORE_MIN || n > SCORE_MAX) {
    return { value: null, issue: { field, message: "out_of_range" } };
  }
  return { value: Math.round(n) };
}

export function parseOptionalNumber(
  v: unknown,
  field: string,
  bounds: { min: number; max: number; integer?: boolean },
): { value: number | null; issue?: FieldIssue } {
  if (missing(v)) return { value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    return { value: null, issue: { field, message: "not_a_number" } };
  }
  if (n < bounds.min || n > bounds.max) {
    return { value: null, issue: { field, message: "out_of_range" } };
  }
  return { value: bounds.integer ? Math.round(n) : n };
}

export function parseHabitCompleted(v: unknown): { value: boolean | null; issue?: FieldIssue } {
  if (v == null || v === "") return { value: null };
  if (typeof v === "boolean") return { value: v };
  if (v === "true" || v === "done" || v === 1) return { value: true };
  if (v === "false" || v === "missed" || v === 0) return { value: false };
  return { value: null, issue: { field: "habit_completed", message: "not_a_boolean" } };
}

export function parseModelConfidence(v: unknown): { value: number; issue?: FieldIssue } {
  if (missing(v)) return { value: 0.6 };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    return { value: 0.6, issue: { field: "confidence", message: "not_a_number" } };
  }
  if (n < 0 || n > 1) {
    return { value: 0.6, issue: { field: "confidence", message: "out_of_range" } };
  }
  return { value: n };
}

export function collectNumericIssues(p: ProposedEntry): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const field of SCORE_FIELDS) {
    const parsed = parseOptionalScore(p[field], field);
    if (parsed.issue) issues.push(parsed.issue);
  }
  for (const [field, bounds] of Object.entries(NUMBER_FIELDS)) {
    const parsed = parseOptionalNumber((p as unknown as Record<string, unknown>)[field], field, bounds);
    if (parsed.issue) issues.push(parsed.issue);
  }
  const habit = parseHabitCompleted(p.habit_completed);
  if (habit.issue) issues.push(habit.issue);
  return issues;
}

/** Block Save when present values are invalid or a habit log has no yes/no. */
export function validateProposalForSave(p: ProposedEntry): FieldIssue[] {
  const issues = [...(p.issues ?? []), ...collectNumericIssues(p)];
  if (p.entry_type === "GOAL_UPDATE" && !p.goal_id) {
    issues.push({ field: "goal_id", message: "required" });
  }
  if (p.entry_type === "HABIT_LOG" && p.habit_completed == null) {
    issues.push({ field: "habit_completed", message: "required" });
  }
  if (p.entry_type === "HABIT_LOG" && !p.habit_id && !p.habit_name?.trim()) {
    issues.push({ field: "habit_name", message: "required" });
  }
  if (p.entry_type === "SKILL_SESSION" && !p.skill_id && !p.skill_name?.trim()) {
    issues.push({ field: "skill_name", message: "required" });
  }
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.field}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function applyNumericFields(
  raw: Record<string, unknown>,
  target: ProposedEntry,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const field of SCORE_FIELDS) {
    const parsed = parseOptionalScore(raw[field], field);
    target[field] = parsed.value;
    if (parsed.issue) issues.push(parsed.issue);
  }
  for (const [field, bounds] of Object.entries(NUMBER_FIELDS)) {
    const parsed = parseOptionalNumber(raw[field], field, bounds);
    (target as unknown as Record<string, unknown>)[field] = parsed.value;
    if (parsed.issue) issues.push(parsed.issue);
  }
  const habit = parseHabitCompleted(raw.habit_completed);
  target.habit_completed = habit.value;
  if (habit.issue) issues.push(habit.issue);
  return issues;
}
