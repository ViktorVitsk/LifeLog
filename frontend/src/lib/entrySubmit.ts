import { enqueueEntry } from "../db/offlineQueue.ts";
import { appConfirmation } from "../agent/confirmation.ts";
import { encryptEntry } from "./crypto.ts";
import type { EntrySyncPayload } from "./api.ts";
import { captureSaveScope, type SaveScope } from "./accountScope.ts";
import { getAccountTimeZone } from "./dates.ts";

export async function encryptAndEnqueue(args: {
  kek: CryptoKey;
  entry_type: string;
  plaintext: Record<string, unknown>;
  openFields: Partial<
    Omit<EntrySyncPayload, "id" | "timestamp" | "entry_type" | "encrypted_content" | "encrypted_dek">
  >;
  timestamp?: string;
  id?: string;
  confirmation_source?: "entry_card" | "manual_form";
  scope?: SaveScope;
  /** Test hook: runs after encryption, before enqueue. */
  afterEncrypt?: () => Promise<void>;
}): Promise<{ id: string }> {
  const scope = args.scope ?? captureSaveScope();
  const { kek, entry_type, openFields } = args;

  const confirm =
    args.plaintext.user_confirmed === true
      ? {
          user_confirmed: true,
          confirmed_at: args.plaintext.confirmed_at,
          confirmation_source: args.plaintext.confirmation_source,
          confirmation_event_id: args.plaintext.confirmation_event_id,
          source_turn_id: args.plaintext.source_turn_id ?? null,
        }
      : appConfirmation({ source: args.confirmation_source ?? "manual_form" });

  const plaintextJson = JSON.stringify({
    v: 1,
    ...args.plaintext,
    ...confirm,
    user_confirmed: true,
  });
  const { encryptedContent, encryptedDek } = await encryptEntry(plaintextJson, kek);

  const id = args.id ?? crypto.randomUUID();
  const payload: EntrySyncPayload = {
    id,
    timestamp: args.timestamp ?? new Date().toISOString(),
    entry_type,
    tags: openFields.tags ?? [],
    mood_score: openFields.mood_score ?? null,
    energy_score: openFields.energy_score ?? null,
    anxiety_score: openFields.anxiety_score ?? null,
    focus_score: openFields.focus_score ?? null,
    social_battery_score: openFields.social_battery_score ?? null,
    stress_score: openFields.stress_score ?? null,
    sleep_hours: openFields.sleep_hours ?? null,
    sleep_quality: openFields.sleep_quality ?? null,
    weight_kg: openFields.weight_kg ?? null,
    body_fat_pct: openFields.body_fat_pct ?? null,
    session_duration_min: openFields.session_duration_min ?? null,
    habit_completed: openFields.habit_completed ?? null,
    habit_value: openFields.habit_value ?? null,
    resentment_score: openFields.resentment_score ?? null,
    guilt_score: openFields.guilt_score ?? null,
    shame_score: openFields.shame_score ?? null,
    fear_score: openFields.fear_score ?? null,
    skill_id: openFields.skill_id ?? null,
    habit_id: openFields.habit_id ?? null,
    context_id: openFields.context_id ?? null,
    encrypted_content: encryptedContent,
    encrypted_dek: encryptedDek,
    recorded_at: new Date().toISOString(),
    event_timezone: getAccountTimeZone(),
  };

  if (args.afterEncrypt) await args.afterEncrypt();
  await enqueueEntry(payload, scope);
  return { id };
}
