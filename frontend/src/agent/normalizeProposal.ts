import {
  applyNumericFields,
  isEntryType,
  parseModelConfidence,
  provenanceOf,
} from "./proposalValidation.ts";
import type { ProposedEntry } from "./types.ts";

type Named = { id: string; name: string };

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function matchByName<T extends { id: string; name: string }>(
  list: T[],
  id?: string,
  name?: string,
): T | undefined {
  if (id) {
    const hit = list.find((x) => x.id === id);
    if (hit) return hit;
  }
  if (name) {
    const q = name.trim().toLowerCase();
    return list.find((x) => x.name.toLowerCase() === q || x.name.toLowerCase().includes(q));
  }
  return undefined;
}

export function normalizeProposal(
  rawIn: Record<string, unknown>,
  skills: Named[],
  habits: Named[],
): ProposedEntry | null {
  const raw = { ...rawIn };
  delete raw.user_confirmed;
  delete raw.confirmed_at;
  delete raw.confirmation_source;
  delete raw.confirmation_event_id;
  delete raw.source_turn_id;
  if (!isEntryType(raw.entry_type)) return null;
  const skill = matchByName(skills, str(raw.skill_id), str(raw.skill_name));
  const habit = matchByName(habits, str(raw.habit_id), str(raw.habit_name));
  const conf = parseModelConfidence(raw.confidence);
  const p: ProposedEntry = {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    entry_type: raw.entry_type,
    confidence: conf.value,
    provenance: provenanceOf(raw.provenance),
    auto_commit: false,
    skill_id: skill?.id,
    skill_name: skill?.name ?? str(raw.skill_name),
    habit_id: habit?.id,
    habit_name: habit?.name ?? str(raw.habit_name),
    reason: str(raw.reason),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((x): x is string => typeof x === "string") : undefined,
    timestamp: str(raw.timestamp),
    time_of_day:
      raw.time_of_day === "morning" || raw.time_of_day === "afternoon" || raw.time_of_day === "evening"
        ? raw.time_of_day
        : undefined,
    notes: str(raw.notes),
    bedtime: str(raw.bedtime),
    wake_time: str(raw.wake_time),
    dream_notes: str(raw.dream_notes),
    resentment: raw.resentment && typeof raw.resentment === "object" ? (raw.resentment as ProposedEntry["resentment"]) : undefined,
    guilt: raw.guilt && typeof raw.guilt === "object" ? (raw.guilt as ProposedEntry["guilt"]) : undefined,
    shame: raw.shame && typeof raw.shame === "object" ? (raw.shame as ProposedEntry["shame"]) : undefined,
    fear: raw.fear && typeof raw.fear === "object" ? (raw.fear as ProposedEntry["fear"]) : undefined,
    reflection: str(raw.reflection),
    cognitive_distortion: str(raw.cognitive_distortion),
    content: str(raw.content),
    items: Array.isArray(raw.items) ? raw.items.filter((x): x is string => typeof x === "string") : undefined,
    custom_metrics:
      raw.custom_metrics && typeof raw.custom_metrics === "object"
        ? (raw.custom_metrics as ProposedEntry["custom_metrics"])
        : undefined,
    what_worked: str(raw.what_worked),
    what_to_improve: str(raw.what_to_improve),
    meal_type: str(raw.meal_type),
    foods: Array.isArray(raw.foods) ? raw.foods.filter((x): x is string => typeof x === "string") : undefined,
    name: str(raw.name),
    unit: str(raw.unit),
    goal_title: str(raw.goal_title),
    status: str(raw.status),
    statement: str(raw.statement),
    category: str(raw.category),
  };
  const issues = applyNumericFields(raw, p);
  if (conf.issue) issues.push(conf.issue);
  p.issues = issues;
  return p;
}
