import { enqueueEntry } from "../db/offlineQueue";
import { encryptEntry } from "./crypto";
import type { EntrySyncPayload } from "./api";

/**
 * Encrypt + enqueue an entry in one shot.
 *
 * The caller provides:
 *   - `plaintext`  — the JSON object that represents the ENCRYPTED schema
 *                    for this entry_type (see ARCHITECTURE §5).
 *   - `openFields` — the open, never-encrypted metadata (mood_score, etc.).
 *
 * We NEVER store `plaintext` anywhere — only its ciphertext.
 */
export async function encryptAndEnqueue(args: {
  kek: CryptoKey;
  entry_type: string;
  plaintext: Record<string, unknown>;
  openFields: Partial<
    Omit<EntrySyncPayload, "id" | "timestamp" | "entry_type" | "encrypted_content" | "encrypted_dek">
  >;
}): Promise<{ id: string }> {
  const { kek, entry_type, plaintext, openFields } = args;

  const plaintextJson = JSON.stringify({ v: 1, ...plaintext });
  const { encryptedContent, encryptedDek } = await encryptEntry(plaintextJson, kek);

  const id = crypto.randomUUID();
  const payload: EntrySyncPayload = {
    id,
    timestamp: new Date().toISOString(),
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
  };

  await enqueueEntry(payload);
  return { id };
}
