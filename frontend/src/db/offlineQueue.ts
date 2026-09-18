import Dexie, { type EntityTable } from "dexie";
import type { EntrySyncPayload } from "../lib/api";

export type QueueStatus = "pending" | "synced" | "error";

/**
 * A single row in the offline queue.
 *
 * What's stored:
 *   - The full `EntrySyncPayload` that we will POST to /api/entries/sync.
 *     This includes `encrypted_content` / `encrypted_dek` (ciphertext) and
 *     open numeric metrics. No plaintext is ever persisted here.
 *   - Sync bookkeeping: status, last_error, attempts, timestamps.
 *
 * Why the open metrics live here:
 *   The dashboard can read `mood_score` / `energy_score` from pending rows
 *   without touching the KEK — those fields are deliberately unencrypted,
 *   matching the server-side policy.
 */
export interface PendingEntry extends EntrySyncPayload {
  /** Local-only: reflects sync progress against the server. */
  status: QueueStatus;
  /** Monotonic timestamp for insertion order (milliseconds). */
  queued_at: number;
  /** Updated on each sync attempt. */
  last_attempt_at?: number;
  /** Human-readable error from the last failed attempt (no PII). */
  last_error?: string;
  /** Increment on every failed POST. Reset to 0 once synced. */
  attempts: number;
}

/** Encrypted chat turn (Phase 6). Plaintext never persisted. */
export interface StoredChatTurn {
  id: string;
  day: string;
  created_at: number;
  encrypted_content: string;
  encrypted_dek: string;
}

export interface StoredLlmSettings {
  id: "default";
  provider: "openrouter" | "ollama";
  model: string;
  base_url: string;
  context_policy: "today" | "7d_open" | "decrypt_n";
  decrypt_n: number;
  encrypted_api_key?: string;
  encrypted_api_key_dek?: string;
}

export interface StoredPinnedChart {
  id: string;
  created_at: number;
  spec_json: string;
}

export class LifeLogDB extends Dexie {
  entries!: EntityTable<PendingEntry, "id">;
  chat_turns!: EntityTable<StoredChatTurn, "id">;
  llm_settings!: EntityTable<StoredLlmSettings, "id">;
  pinned_charts!: EntityTable<StoredPinnedChart, "id">;

  constructor() {
    super("lifelog");
    this.version(1).stores({
      entries: "id, status, entry_type, timestamp, queued_at",
    });
    this.version(2).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id",
    });
    this.version(3).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id",
      chat_turns: "id, day, created_at",
      llm_settings: "id",
      pinned_charts: "id, created_at",
    });
  }
}

export const db = new LifeLogDB();

// ─────────────────────────────────────────────────────────────────────────────
// Queue operations
// ─────────────────────────────────────────────────────────────────────────────

export async function enqueueEntry(payload: EntrySyncPayload): Promise<void> {
  await db.entries.put({
    ...payload,
    status: "pending",
    queued_at: Date.now(),
    attempts: 0,
  });
}

export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.entries.where("id").anyOf(ids).modify({ status: "synced", attempts: 0 });
}

export async function markError(ids: string[], error: string): Promise<void> {
  if (ids.length === 0) return;
  await db.entries
    .where("id")
    .anyOf(ids)
    .modify((entry) => {
      entry.status = "error";
      entry.last_error = error.slice(0, 200);
      entry.last_attempt_at = Date.now();
      entry.attempts = (entry.attempts ?? 0) + 1;
    });
}

export async function getPendingForSync(limit = 50): Promise<PendingEntry[]> {
  // "pending" OR "error" (retry errors too). Oldest first.
  const rows = await db.entries
    .where("status")
    .anyOf(["pending", "error"])
    .sortBy("queued_at");
  return rows.slice(0, limit);
}

export async function countPending(): Promise<number> {
  return db.entries.where("status").anyOf(["pending", "error"]).count();
}

export async function getRecentEntries(sinceMs: number): Promise<PendingEntry[]> {
  const sinceIso = new Date(sinceMs).toISOString();
  return db.entries.where("timestamp").above(sinceIso).toArray();
}

/** Purge successfully synced entries older than `olderThanMs`. */
export async function pruneSynced(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return db.entries
    .where("status")
    .equals("synced")
    .and((e) => e.queued_at < cutoff)
    .delete();
}

/** Undo a local queue row. Does not DELETE on the server if already synced. */
export async function deleteLocalEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.entries.bulkDelete(ids);
}
