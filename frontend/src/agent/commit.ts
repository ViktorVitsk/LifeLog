import type { Habit, Skill } from "../lib/api";
import { encryptAndEnqueue } from "../lib/entrySubmit";
import type { AppLocale } from "../i18n/locale";
import { STRINGS } from "../i18n/strings";
import { ENTRY_TYPES, type EntryTypeName, type ProposedEntry, type Provenance } from "./types";

function isEntryType(v: unknown): v is EntryTypeName {
  return typeof v === "string" && (ENTRY_TYPES as readonly string[]).includes(v);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function score(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(clamp(n, 1, 10));
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

function provenanceOf(v: unknown): Provenance {
  if (v === "user_stated" || v === "agent_extracted" || v === "agent_inferred") return v;
  return "agent_extracted";
}

export function normalizeProposal(
  raw: Record<string, unknown>,
  skills: Skill[],
  habits: Habit[],
): ProposedEntry | null {
  if (!isEntryType(raw.entry_type)) return null;
  const skill = matchByName(skills, str(raw.skill_id), str(raw.skill_name));
  const habit = matchByName(habits, str(raw.habit_id), str(raw.habit_name));
  const conf = Number(raw.confidence);
  return {
    ...(raw as unknown as ProposedEntry),
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    entry_type: raw.entry_type,
    confidence: Number.isFinite(conf) ? clamp(conf, 0, 1) : 0.6,
    provenance: provenanceOf(raw.provenance),
    auto_commit: Boolean(raw.auto_commit),
    skill_id: skill?.id,
    skill_name: skill?.name ?? str(raw.skill_name),
    habit_id: habit?.id,
    habit_name: habit?.name ?? str(raw.habit_name),
    mood_score: score(raw.mood_score),
    energy_score: score(raw.energy_score),
    anxiety_score: score(raw.anxiety_score),
    focus_score: score(raw.focus_score),
    social_battery_score: score(raw.social_battery_score),
    stress_score: score(raw.stress_score),
    sleep_quality: score(raw.sleep_quality),
    resentment_score: score(raw.resentment_score),
    guilt_score: score(raw.guilt_score),
    shame_score: score(raw.shame_score),
    fear_score: score(raw.fear_score),
    sleep_hours: num(raw.sleep_hours),
    session_duration_min: num(raw.session_duration_min),
    habit_value: num(raw.habit_value),
    weight_kg: num(raw.weight_kg),
    body_fat_pct: num(raw.body_fat_pct),
    waist_cm: num(raw.waist_cm),
    resting_hr: num(raw.resting_hr),
    calories_estimate: num(raw.calories_estimate),
    protein_estimate: num(raw.protein_estimate),
    dose: num(raw.dose),
    progress_pct: num(raw.progress_pct),
  };
}

function openTags(p: ProposedEntry, extra: string[]): string[] {
  return [...new Set([...(p.tags ?? []), ...extra, "agent", "confirmed"])];
}

/** Used after the user taps Save — always confirmed. */
type CommitMeta = { source_turn_id?: string; user_confirmed: boolean };

export async function commitProposedEntry(
  p: ProposedEntry,
  kek: CryptoKey,
  meta: CommitMeta,
): Promise<{ id: string }> {
  const prov = {
    provenance: p.provenance,
    confidence: p.confidence,
    source_turn_id: meta.source_turn_id ?? null,
    user_confirmed: meta.user_confirmed,
  };
  const ts = p.timestamp;
  const extraTags = openTags(p, []);

  switch (p.entry_type) {
    case "DAILY_CHECKIN":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          time_of_day: p.time_of_day,
          notes: p.notes ?? p.content,
          ...prov,
        },
        openFields: {
          mood_score: p.mood_score,
          energy_score: p.energy_score,
          anxiety_score: p.anxiety_score,
          focus_score: p.focus_score,
          social_battery_score: p.social_battery_score,
          stress_score: p.stress_score,
          tags: extraTags.concat(p.time_of_day ? [p.time_of_day] : ["checkin"]),
        },
      });
    case "SLEEP":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          bedtime: p.bedtime,
          wake_time: p.wake_time,
          dream_notes: p.dream_notes,
          ...prov,
        },
        openFields: {
          sleep_hours: p.sleep_hours,
          sleep_quality: p.sleep_quality,
          tags: extraTags.concat(["sleep"]),
        },
      });
    case "EMOTIONAL_STATE":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          resentment: p.resentment,
          guilt: p.guilt,
          shame: p.shame,
          fear: p.fear,
          reflection: p.reflection ?? p.notes,
          cognitive_distortion: p.cognitive_distortion,
          ...prov,
        },
        openFields: {
          resentment_score: p.resentment_score,
          guilt_score: p.guilt_score,
          shame_score: p.shame_score,
          fear_score: p.fear_score,
          tags: extraTags.concat(["emotion"]),
        },
      });
    case "THOUGHT":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: { content: p.content ?? p.notes ?? "", mood_score: p.mood_score, ...prov },
        openFields: {
          mood_score: p.mood_score,
          tags: extraTags,
        },
      });
    case "GRATITUDE": {
      const items = (p.items ?? []).map((x) => x.trim()).filter(Boolean);
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: { items, ...prov },
        openFields: { tags: extraTags.concat(["gratitude"]) },
      });
    }
    case "SKILL_SESSION":
      if (!p.skill_id) throw new Error("Skill session needs a matching skill. Create it first.");
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          custom_metrics: p.custom_metrics ?? {},
          what_worked: p.what_worked,
          what_to_improve: p.what_to_improve,
          notes: p.notes,
          ...prov,
        },
        openFields: {
          skill_id: p.skill_id,
          session_duration_min: p.session_duration_min,
          tags: extraTags.concat(["skill_session"]),
        },
      });
    case "HABIT_LOG":
      if (!p.habit_id) throw new Error("Habit log needs a matching habit. Create it first.");
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: { notes: p.notes, ...prov },
        openFields: {
          habit_id: p.habit_id,
          habit_completed: p.habit_completed ?? true,
          habit_value: p.habit_value,
          tags: extraTags.concat(["habit_log"]),
        },
      });
    case "BODY_METRICS":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          waist_cm: p.waist_cm ?? undefined,
          resting_hr: p.resting_hr ?? undefined,
          notes: p.notes,
          ...prov,
        },
        openFields: {
          weight_kg: p.weight_kg,
          body_fat_pct: p.body_fat_pct,
          tags: extraTags.concat(["body"]),
        },
      });
    case "MEAL":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          meal_type: p.meal_type,
          foods: p.foods ?? [],
          calories_estimate: p.calories_estimate,
          protein_estimate: p.protein_estimate,
          notes: p.notes,
          ...prov,
        },
        openFields: { tags: extraTags.concat(["meal"]) },
      });
    case "SUPPLEMENT":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: { name: p.name, dose: p.dose, unit: p.unit, ...prov },
        openFields: { tags: extraTags.concat(["supplement"]) },
      });
    case "GOAL_UPDATE":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          goal_title: p.goal_title,
          progress_pct: p.progress_pct,
          status: p.status,
          reflection: p.reflection ?? p.notes,
          ...prov,
        },
        openFields: { tags: extraTags.concat(["goal"]) },
      });
    case "BELIEF":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: {
          statement: p.statement ?? p.content,
          belief_confidence: p.confidence,
          category: p.category,
          notes: p.notes,
          ...prov,
        },
        openFields: { tags: extraTags.concat(["belief"]) },
      });
  }
}

export function summaryLine(p: ProposedEntry, locale: AppLocale = "ru"): string {
  const t = STRINGS[locale];
  switch (p.entry_type) {
    case "SLEEP":
      return [p.sleep_hours != null ? `${p.sleep_hours}h` : null, p.sleep_quality != null ? `q${p.sleep_quality}` : null]
        .filter(Boolean)
        .join(" · ");
    case "DAILY_CHECKIN":
      return [
        p.mood_score != null ? `${t.mood} ${p.mood_score}` : null,
        p.energy_score != null ? `${t.energy} ${p.energy_score}` : null,
        p.anxiety_score != null ? `${t.anxiety} ${p.anxiety_score}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "HABIT_LOG":
      return `${p.habit_name ?? t.typeHabit} · ${p.habit_completed === false ? t.habitMissed : t.habitDone}`;
    case "SKILL_SESSION":
      return `${p.skill_name ?? t.typeSkill} · ${p.session_duration_min ?? "?"} ${t.minutes.toLowerCase()}`;
    case "GRATITUDE":
      return (p.items ?? []).filter(Boolean).join("; ");
    case "THOUGHT":
      return (p.content ?? p.notes ?? "").slice(0, 80);
    default:
      return p.reason ?? p.notes ?? p.content ?? "";
  }
}
