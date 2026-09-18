import Dexie, { type EntityTable } from "dexie";
import { assertEncryptAllowed, getCurrentUserId, requireCurrentUserId } from "../lib/accountScope";
import type { EntrySyncPayload } from "../lib/api";

export type QueueStatus = "pending" | "synced" | "error";

export interface PendingEntry extends EntrySyncPayload {
  status: QueueStatus;
  queued_at: number;
  last_attempt_at?: number;
  last_error?: string;
  attempts: number;
  owner_user_id?: string;
}

export interface StoredChatTurn {
  id: string;
  day: string;
  created_at: number;
  encrypted_content: string;
  encrypted_dek: string;
  owner_user_id?: string;
}

export interface StoredLlmSettings {
  id: string;
  owner_user_id?: string;
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
  owner_user_id?: string;
}

export interface StoredKekVerifier {
  owner_user_id: string;
  encrypted_content: string;
  encrypted_dek: string;
  created_at: number;
}

export class LifeLogDB extends Dexie {
  entries!: EntityTable<PendingEntry, "id">;
  chat_turns!: EntityTable<StoredChatTurn, "id">;
  llm_settings!: EntityTable<StoredLlmSettings, "id">;
  pinned_charts!: EntityTable<StoredPinnedChart, "id">;
  kek_verifiers!: EntityTable<StoredKekVerifier, "owner_user_id">;

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
    this.version(4).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id, owner_user_id",
      chat_turns: "id, day, created_at, owner_user_id",
      llm_settings: "id",
      pinned_charts: "id, created_at, owner_user_id",
      kek_verifiers: "owner_user_id",
    });
  }
}

export const db = new LifeLogDB();

export async function enqueueEntry(payload: EntrySyncPayload): Promise<void> {
  assertEncryptAllowed();
  const owner = requireCurrentUserId();
  await db.entries.put({
    ...payload,
    owner_user_id: owner,
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

export async function getPendingForSync(limit = 50, userId?: string): Promise<PendingEntry[]> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return [];
  const rows = await db.entries
    .where("status")
    .anyOf(["pending", "error"])
    .sortBy("queued_at");
  return rows.filter((r) => r.owner_user_id === owner).slice(0, limit);
}

export async function countPending(userId?: string): Promise<number> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return 0;
  const rows = await db.entries.where("status").anyOf(["pending", "error"]).toArray();
  return rows.filter((r) => r.owner_user_id === owner).length;
}

export async function getRecentEntries(sinceMs: number): Promise<PendingEntry[]> {
  const owner = getCurrentUserId();
  const sinceIso = new Date(sinceMs).toISOString();
  const rows = await db.entries.where("timestamp").above(sinceIso).toArray();
  if (!owner) return [];
  return rows.filter((r) => r.owner_user_id === owner);
}

export async function pruneSynced(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return db.entries
    .where("status")
    .equals("synced")
    .and((e) => e.queued_at < cutoff)
    .delete();
}

export async function deleteLocalEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const owner = getCurrentUserId();
  if (!owner) return;
  const rows = await db.entries.bulkGet(ids);
  const mine = rows.filter((r): r is PendingEntry => Boolean(r && r.owner_user_id === owner));
  await db.entries.bulkDelete(mine.map((r) => r.id));
}

export async function listOrphanEntries(): Promise<PendingEntry[]> {
  const rows = await db.entries.toArray();
  return rows.filter((r) => r.owner_user_id == null || r.owner_user_id === "");
}

export async function attachOrphansToUser(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let n = 0;
  await db.entries
    .where("id")
    .anyOf(ids)
    .modify((row) => {
      if (row.owner_user_id == null || row.owner_user_id === "") {
        row.owner_user_id = userId;
        n += 1;
      }
    });
  return n;
}

export async function deleteOrphanEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db.entries.bulkGet(ids);
  const orphans = rows.filter((r): r is PendingEntry => Boolean(r && !r.owner_user_id));
  await db.entries.bulkDelete(orphans.map((r) => r.id));
}
