import Dexie, { type EntityTable } from "dexie";
import {
  assertEncryptAllowed,
  getCurrentUserId,
  requireCurrentUserId,
  type SaveScope,
} from "../lib/accountScope.ts";
import type { EntrySyncPayload } from "../lib/api.ts";
import { getTestQueue } from "./testQueue.ts";

export type QueueStatus = "pending" | "synced" | "error" | "rejected" | "conflict" | "pending_delete";

export interface PendingEntry extends EntrySyncPayload {
  status: QueueStatus;
  queued_at: number;
  last_attempt_at?: number;
  last_error?: string;
  attempts: number;
  owner_user_id?: string;
  local_rev?: number;
  inflight_rev?: number;
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
  provider: "openrouter" | "ollama" | "synthetic";
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

export type LifeKind = "goal" | "memory" | "action" | "feedback";

export interface PendingLife {
  id: string;
  kind: LifeKind;
  payload: Record<string, unknown>;
  status: QueueStatus;
  owner_user_id: string;
  queued_at: number;
  last_error?: string;
  local_rev?: number;
  inflight_rev?: number;
  server_version?: number;
}

export class LifeLogDB extends Dexie {
  entries!: EntityTable<PendingEntry, "id">;
  chat_turns!: EntityTable<StoredChatTurn, "id">;
  llm_settings!: EntityTable<StoredLlmSettings, "id">;
  pinned_charts!: EntityTable<StoredPinnedChart, "id">;
  kek_verifiers!: EntityTable<StoredKekVerifier, "owner_user_id">;
  life_queue!: EntityTable<PendingLife, "id">;

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
    this.version(5).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id, owner_user_id",
      chat_turns: "id, day, created_at, owner_user_id",
      llm_settings: "id",
      pinned_charts: "id, created_at, owner_user_id",
      kek_verifiers: "owner_user_id",
      life_queue: "id, kind, status, owner_user_id, queued_at",
    });
  }
}

export const db = new LifeLogDB();

export function resolveWriteOwner(scope?: SaveScope): string {
  if (scope) return scope.owner;
  assertEncryptAllowed();
  return requireCurrentUserId();
}

export async function enqueueEntry(payload: EntrySyncPayload, scope?: SaveScope): Promise<void> {
  const owner = resolveWriteOwner(scope);
  const test = getTestQueue();
  const existing = test ? test.entries.get(payload.id) : await db.entries.get(payload.id);
  const row: PendingEntry = {
    ...payload,
    owner_user_id: owner,
    status: payload.deleted ? "pending_delete" : "pending",
    queued_at: Date.now(),
    attempts: 0,
    local_rev: (existing?.local_rev ?? 0) + 1,
    inflight_rev: existing?.inflight_rev,
  };
  if (test) {
    test.entries.set(row.id, row);
    return;
  }
  await db.entries.put(row);
}

export async function markSynced(
  ids: string[],
  opts?: { sentRevs?: Record<string, number>; versions?: Record<string, number> },
): Promise<void> {
  if (ids.length === 0) return;
  const sentRevs = opts?.sentRevs ?? {};
  const versions = opts?.versions ?? {};
  const apply = (entry: PendingEntry) => {
    const sent = sentRevs[entry.id];
    if (sent != null && (entry.local_rev ?? 1) !== sent) {
      entry.inflight_rev = undefined;
      return;
    }
    entry.status = "synced";
    entry.attempts = 0;
    entry.inflight_rev = undefined;
    if (versions[entry.id] != null) entry.version = versions[entry.id];
    else if (entry.version == null) entry.version = 1;
  };
  const test = getTestQueue();
  if (test) {
    for (const id of ids) {
      const row = test.entries.get(id);
      if (row) apply(row);
    }
    return;
  }
  await db.entries
    .where("id")
    .anyOf(ids)
    .modify(apply);
}

export async function markError(ids: string[], error: string): Promise<void> {
  if (ids.length === 0) return;
  const apply = (entry: PendingEntry) => {
    entry.status = "error";
    entry.last_error = error.slice(0, 200);
    entry.last_attempt_at = Date.now();
    entry.attempts = (entry.attempts ?? 0) + 1;
  };
  const test = getTestQueue();
  if (test) {
    for (const id of ids) {
      const row = test.entries.get(id);
      if (row) apply(row);
    }
    return;
  }
  await db.entries.where("id").anyOf(ids).modify(apply);
}

export async function markRejected(items: { id: string; reason: string; conflict?: boolean }[]): Promise<void> {
  if (items.length === 0) return;
  const byId = new Map(items.map((item) => [item.id, item]));
  const apply = (entry: PendingEntry) => {
    const item = byId.get(entry.id);
    if (!item) return;
    entry.status = item.conflict || item.reason === "version_mismatch" ? "conflict" : "rejected";
    entry.last_error = item.reason.slice(0, 200);
    entry.last_attempt_at = Date.now();
    entry.attempts = (entry.attempts ?? 0) + 1;
  };
  const test = getTestQueue();
  if (test) {
    for (const id of byId.keys()) {
      const row = test.entries.get(id);
      if (row) apply(row);
    }
    return;
  }
  await db.entries.where("id").anyOf([...byId.keys()]).modify(apply);
}

export async function getPendingForSync(limit = 50, userId?: string): Promise<PendingEntry[]> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return [];
  const test = getTestQueue();
  const rows = test
    ? [...test.entries.values()]
    : await db.entries.where("status").anyOf(["pending", "error", "pending_delete"]).sortBy("queued_at");
  return rows
    .filter((r) => r.owner_user_id === owner && ["pending", "error", "pending_delete"].includes(r.status))
    .sort((a, b) => a.queued_at - b.queued_at)
    .slice(0, limit);
}

export async function countPending(userId?: string): Promise<number> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return 0;
  const rows = await db.entries.where("status").anyOf(["pending", "error", "pending_delete"]).toArray();
  return rows.filter((r) => r.owner_user_id === owner).length;
}

export async function markPendingDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const owner = getCurrentUserId();
  if (!owner) return;
  await db.entries
    .where("id")
    .anyOf(ids)
    .modify((entry) => {
      if (entry.owner_user_id !== owner) return;
      entry.status = "pending_delete";
      entry.deleted = true;
      entry.last_attempt_at = Date.now();
    });
}

export async function ackDeletes(ids: string[]): Promise<void> {
  await deleteLocalEntries(ids);
}

export async function markInflight(ids: string[]): Promise<Record<string, number>> {
  const sent: Record<string, number> = {};
  const apply = (row: { id: string; local_rev?: number; inflight_rev?: number }) => {
    const rev = row.local_rev ?? 1;
    row.inflight_rev = rev;
    sent[row.id] = rev;
  };
  const test = getTestQueue();
  if (test) {
    for (const id of ids) {
      const row = test.entries.get(id);
      if (row) apply(row);
    }
    return sent;
  }
  const rows = await db.entries.bulkGet(ids);
  for (const row of rows) {
    if (!row) continue;
    apply(row);
    await db.entries.put(row);
  }
  return sent;
}

export async function getEntryStatuses(ids: string[]): Promise<Record<string, QueueStatus>> {
  const rows = await db.entries.bulkGet(ids);
  const out: Record<string, QueueStatus> = {};
  for (const row of rows) {
    if (row) out[row.id] = row.status;
  }
  return out;
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

/** Drop only explicit tombstone ids. A missing list-page id never deletes a local copy. */
export async function applyEntryTombstones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const droppable = (row: PendingEntry | undefined) =>
    Boolean(row && (row.status === "synced" || row.status === "pending_delete"));
  const test = getTestQueue();
  if (test) {
    for (const id of ids) {
      const row = test.entries.get(id);
      if (droppable(row)) test.entries.delete(id);
    }
    return;
  }
  const rows = await db.entries.bulkGet(ids);
  await db.entries.bulkDelete(rows.filter((row): row is PendingEntry => droppable(row)).map((row) => row.id));
}
