import { encryptAndEnqueue } from "../lib/entrySubmit";
import { localDayKey, sleepEventTimestamp } from "../lib/dates";
import type { AppCommitMeta } from "./confirmation";
import { requireAppConfirmation } from "./confirmation";
import type { AppLocale } from "../i18n/locale";
import { STRINGS } from "../i18n/strings";
import { validateProposalForSave } from "./proposalValidation";
import { normalizeProposal } from "./normalizeProposal";
import type { ProposedEntry } from "./types";

export { normalizeProposal };

function openTags(p: ProposedEntry, extra: string[], userConfirmed: boolean): string[] {
  const tags = [...(p.tags ?? []), ...extra, "agent"].filter((t) => t && t !== "confirmed");
  if (userConfirmed) tags.push("confirmed");
  return [...new Set(tags)];
}

export function buildProvenancePlaintext(
  p: ProposedEntry,
  meta: AppCommitMeta,
): Record<string, unknown> {
  return {
    provenance: p.provenance,
    model_confidence: p.confidence,
    source_turn_id: meta.source_turn_id,
    confirmation_event_id: meta.confirmation_event_id,
    confirmed_at: meta.confirmed_at,
    confirmation_source: meta.confirmation_source,
    user_confirmed: true,
  };
}

export async function commitProposedEntry(
  p: ProposedEntry,
  kek: CryptoKey,
  meta: AppCommitMeta,
): Promise<{ id: string; confirmation_event_id: string }> {
  requireAppConfirmation(meta);
  const issues = validateProposalForSave(p);
  if (issues.length) {
    throw new Error(issues.map((i) => `${i.field}:${i.message}`).join("; "));
  }
  const prov = buildProvenancePlaintext(p, meta);
  const ts = p.timestamp;
  const extraTags = openTags(p, [], true);

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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
    case "SLEEP":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: sleepEventTimestamp({
          wakeTime: p.wake_time,
          wakeDate: p.timestamp && /^\d{4}-\d{2}-\d{2}$/.test(p.timestamp) ? p.timestamp : localDayKey(),
          fallback: ts,
        }),
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
    case "GRATITUDE": {
      const items = (p.items ?? []).map((x) => x.trim()).filter(Boolean);
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: { items, ...prov },
        openFields: { tags: extraTags.concat(["gratitude"]) },
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
    case "HABIT_LOG":
      if (!p.habit_id) throw new Error("Habit log needs a matching habit. Create it first.");
      if (p.habit_completed == null) throw new Error("habit_completed:required");
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: { notes: p.notes, ...prov },
        openFields: {
          habit_id: p.habit_id,
          habit_completed: p.habit_completed,
          habit_value: p.habit_value,
          tags: extraTags.concat(["habit_log"]),
        },
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
    case "SUPPLEMENT":
      return encryptAndEnqueue({
        kek,
        entry_type: p.entry_type,
        timestamp: ts,
        plaintext: { name: p.name, dose: p.dose, unit: p.unit, ...prov },
        openFields: { tags: extraTags.concat(["supplement"]) },
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      }).then((r) => ({ ...r, confirmation_event_id: meta.confirmation_event_id }));
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
      return `${p.habit_name ?? t.typeHabit} · ${
        p.habit_completed == null ? t.habitUnset : p.habit_completed === false ? t.habitMissed : t.habitDone
      }`;
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
