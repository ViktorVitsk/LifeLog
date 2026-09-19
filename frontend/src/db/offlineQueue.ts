import Dexie, { type EntityTable } from "dexie";
import {
  assertEncryptAllowed,
  getCurrentUserId,
  requireCurrentUserId,
  type SaveScope,
} from "../lib/accountScope.ts";
import type { EntryRead, EntrySyncPayload } from "../lib/api.ts";
import { ackKindFromStatus, applyRevisionAck } from "../lib/queueAck.ts";
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
  conflict_version?: number;
  created_at?: string;
  cached_at?: string;
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
  conflict_version?: number;
  server_snapshot?: Record<string, unknown>;
}

export type LifeOpKind = "feedback_and_action" | "feedback_correction";
export type LifeOpStatus =
  | "local"
  | "feedback_acked"
  | "action_acked"
  | "done"
  | "action_conflict"
  | "superseded";

export interface LifeOp {
  id: string;
  owner_user_id: string;
  session_id: number;
  kind: LifeOpKind;
  status: LifeOpStatus;
  submission_id: string;
  feedback_id: string;
  action_id: string;
  expected_action_version?: number | null;
  expected_action_local_rev?: number | null;
  feedback_local_rev?: number | null;
  action_local_rev?: number | null;
  feedback_acked?: boolean;
  action_acked?: boolean;
  feedback_payload?: Record<string, unknown> | null;
  action_payload?: Record<string, unknown> | null;
  created_at: number;
}

export class LifeLogDB extends Dexie {
  entries!: EntityTable<PendingEntry, "id">;
  chat_turns!: EntityTable<StoredChatTurn, "id">;
  llm_settings!: EntityTable<StoredLlmSettings, "id">;
  pinned_charts!: EntityTable<StoredPinnedChart, "id">;
  kek_verifiers!: EntityTable<StoredKekVerifier, "owner_user_id">;
  life_queue!: EntityTable<PendingLife, "id">;
  life_ops!: EntityTable<LifeOp, "id">;

  constructor(name = "lifelog") {
    super(name);
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
    this.version(6).stores({
      life_ops: "id, owner_user_id, action_id, status",
    });
    this.version(7)
      .stores({
        life_ops: "id, owner_user_id, action_id, status, submission_id",
      })
      .upgrade((tx) =>
        tx
          .table("life_ops")
          .toCollection()
          .modify((row) => {
            const next = migrateLifeOpRow(row as Record<string, unknown>);
            delete (row as { intent_key?: string }).intent_key;
            (row as { submission_id?: string }).submission_id = String(next.submission_id ?? row.id);
            if ((row as { kind?: string }).kind !== "feedback_correction") {
              (row as { kind?: string }).kind = "feedback_and_action";
            }
          }),
      );
  }
}

export const db = new LifeLogDB();

export function getLifeDb(): LifeLogDB {
  return db;
}

export function resolveQueueAccess(store?: LifeLogDB): { test: ReturnType<typeof getTestQueue>; db: LifeLogDB | undefined } {
  if (store) return { test: null, db: store };
  const test = getTestQueue();
  if (test) return { test, db: undefined };
  return { test: null, db };
}

export function migrateLifeOpRow(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  delete next.intent_key;
  if (typeof next.submission_id !== "string" || !next.submission_id) {
    next.submission_id = String(next.id ?? "");
  }
  if (next.kind !== "feedback_correction") next.kind = "feedback_and_action";
  return next;
}

export function stripDoneOpPayloads(op: LifeOp): LifeOp {
  if (op.status !== "done") return op;
  return { ...op, feedback_payload: null, action_payload: null };
}

export function finalizeLifeOpStatus(op: LifeOp): LifeOp {
  if (op.status === "superseded" || op.status === "action_conflict") return op;
  let status: LifeOpStatus = "local";
  if (op.feedback_acked && (op.action_local_rev == null || op.action_acked)) status = "done";
  else if (op.feedback_acked) status = "feedback_acked";
  else if (op.action_acked) status = "action_acked";
  return stripDoneOpPayloads({ ...op, status });
}

export function applyOpEntityAck(
  op: LifeOp,
  entityId: string,
  localRev: number,
  result: { status: string },
): LifeOp {
  if (op.status === "done" || op.status === "superseded") return op;
  const ok = result.status === "created" || result.status === "updated" || result.status === "duplicate";
  const bad = result.status === "conflict" || result.status === "rejected";
  const next = { ...op };
  if (op.feedback_id === entityId && op.feedback_local_rev === localRev) {
    if (ok) next.feedback_acked = true;
    else if (bad) next.status = "action_conflict";
  }
  if (op.action_id === entityId && op.action_local_rev != null && op.action_local_rev === localRev) {
    if (ok) next.action_acked = true;
    else if (bad) next.status = "action_conflict";
  }
  return finalizeLifeOpStatus(next);
}

export async function ackLifeOpsForResult(
  entityId: string,
  localRev: number,
  result: { status: string },
  store?: LifeLogDB,
): Promise<void> {
  const { test, db: target } = resolveQueueAccess(store);
  const rows = test ? [...test.ops.values()] : target ? await target.life_ops.toArray() : [];
  for (const op of rows) {
    const next = applyOpEntityAck(op, entityId, localRev, result);
    if (
      next.status === op.status &&
      next.feedback_acked === op.feedback_acked &&
      next.action_acked === op.action_acked &&
      next.feedback_payload === op.feedback_payload &&
      next.action_payload === op.action_payload
    ) {
      continue;
    }
    if (test) test.ops.set(next.id, next);
    else if (target) await target.life_ops.put(next);
  }
}

export function resolveWriteOwner(scope?: SaveScope): string {
  if (scope) return scope.owner;
  assertEncryptAllowed();
  return requireCurrentUserId();
}

export function nextEntryEnqueue(existing: PendingEntry | undefined, payload: EntrySyncPayload, owner: string): PendingEntry {
  const edited = Date.now();
  return {
    ...payload,
    owner_user_id: owner,
    status: payload.deleted ? "pending_delete" : "pending",
    queued_at: edited,
    attempts: existing?.attempts ?? 0,
    local_rev: (existing?.local_rev ?? 0) + 1,
    inflight_rev: existing?.inflight_rev,
    version: existing?.version ?? payload.version,
    conflict_version: existing?.conflict_version,
    created_at: existing?.created_at ?? new Date(edited).toISOString(),
    cached_at: existing?.cached_at,
  };
}

export async function enqueueEntry(payload: EntrySyncPayload, scope?: SaveScope, store?: LifeLogDB): Promise<void> {
  const owner = resolveWriteOwner(scope);
  const { test, db: target } = resolveQueueAccess(store);
  if (test) {
    test.entries.set(payload.id, nextEntryEnqueue(test.entries.get(payload.id), payload, owner));
    return;
  }
  if (!target) return;
  await target.transaction("rw", target.entries, async () => {
    const existing = await target.entries.get(payload.id);
    await target.entries.put(nextEntryEnqueue(existing, payload, owner));
  });
}

export interface EntrySendSnapshot {
  id: string;
  owner: string;
  local_rev: number;
  payload: EntrySyncPayload;
}

function dummyPayload(id: string, deleted = false): EntrySyncPayload {
  return { id, timestamp: "", entry_type: "THOUGHT", encrypted_dek: "", encrypted_content: "", tags: [], deleted };
}

function toEntryPayload(row: PendingEntry): EntrySyncPayload {
  return {
    id: row.id,
    timestamp: row.timestamp,
    entry_type: row.entry_type,
    skill_id: row.skill_id,
    habit_id: row.habit_id,
    context_id: row.context_id,
    tags: row.tags ?? [],
    mood_score: row.mood_score,
    energy_score: row.energy_score,
    anxiety_score: row.anxiety_score,
    focus_score: row.focus_score,
    social_battery_score: row.social_battery_score,
    stress_score: row.stress_score,
    sleep_hours: row.sleep_hours,
    sleep_quality: row.sleep_quality,
    weight_kg: row.weight_kg,
    body_fat_pct: row.body_fat_pct,
    session_duration_min: row.session_duration_min,
    habit_completed: row.habit_completed,
    habit_value: row.habit_value,
    resentment_score: row.resentment_score,
    guilt_score: row.guilt_score,
    shame_score: row.shame_score,
    fear_score: row.fear_score,
    encrypted_dek: row.encrypted_dek,
    encrypted_content: row.encrypted_content,
    version: row.version ?? 1,
    deleted: row.status === "pending_delete" || row.deleted === true,
    recorded_at: row.recorded_at,
    event_timezone: row.event_timezone,
  };
}

export async function claimPendingEntries(limit = 50, userId?: string, store?: LifeLogDB): Promise<EntrySendSnapshot[]> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return [];
  const snapshots: EntrySendSnapshot[] = [];
  const take = (row: PendingEntry) => {
    if (row.owner_user_id !== owner) return;
    if (!["pending", "error", "pending_delete"].includes(row.status)) return;
    const local_rev = row.local_rev ?? 1;
    row.inflight_rev = local_rev;
    snapshots.push({ id: row.id, owner, local_rev, payload: toEntryPayload(row) });
  };
  const { test, db: target } = resolveQueueAccess(store);
  if (test) {
    const rows = [...test.entries.values()].sort((a, b) => a.queued_at - b.queued_at);
    for (const row of rows) {
      if (snapshots.length >= limit) break;
      take(row);
    }
    return snapshots;
  }
  if (!target) return snapshots;
  await target.transaction("rw", target.entries, async () => {
    const rows = await target.entries
      .where("status")
      .anyOf(["pending", "error", "pending_delete"])
      .sortBy("queued_at");
    for (const row of rows) {
      if (snapshots.length >= limit) break;
      if (row.owner_user_id !== owner) continue;
      const local_rev = row.local_rev ?? 1;
      row.inflight_rev = local_rev;
      await target.entries.put(row);
      snapshots.push({ id: row.id, owner, local_rev, payload: toEntryPayload(row) });
    }
  });
  return snapshots;
}

function applyToEntry(
  row: PendingEntry,
  sent: { owner: string; local_rev: number },
  ack: { kind: "success" | "conflict" | "rejected" | "error" | "deleted"; version?: number | null; reason?: string | null },
) {
  const out = applyRevisionAck(
    {
      local_rev: row.local_rev,
      inflight_rev: row.inflight_rev,
      server_version: row.version ?? undefined,
      status: row.status,
      last_error: row.last_error,
      conflict_version: row.conflict_version,
      owner_user_id: row.owner_user_id,
    },
    sent,
    ack,
  );
  return {
    drop: out.drop,
    ignored: out.ignored,
    row: {
      ...row,
      local_rev: out.row.local_rev,
      inflight_rev: out.row.inflight_rev,
      version: out.row.server_version,
      status: out.row.status,
      last_error: out.row.last_error,
      conflict_version: out.row.conflict_version,
    } satisfies PendingEntry,
  };
}

export async function applyEntryResult(
  snapshot: EntrySendSnapshot,
  result: { status: string; reason?: string | null; version?: number | null },
  store?: LifeLogDB,
): Promise<void> {
  const ack = {
    kind: result.status === "error" ? ("error" as const) : ackKindFromStatus(result.status),
    version: result.version,
    reason: result.reason,
  };
  const { test, db: target } = resolveQueueAccess(store);
  if (test) {
    const row = test.entries.get(snapshot.id);
    if (!row) return;
    const out = applyToEntry(row, { owner: snapshot.owner, local_rev: snapshot.local_rev }, ack);
    if (out.ignored) return;
    if (out.drop) test.entries.delete(snapshot.id);
    else test.entries.set(snapshot.id, out.row);
    return;
  }
  if (!target) return;
  await target.transaction("rw", target.entries, async () => {
    const row = await target.entries.get(snapshot.id);
    if (!row) return;
    const out = applyToEntry(row, { owner: snapshot.owner, local_rev: snapshot.local_rev }, ack);
    if (out.ignored) return;
    if (out.drop) await target.entries.delete(snapshot.id);
    else await target.entries.put(out.row);
  });
}

export async function markSynced(
  ids: string[],
  opts?: { sentRevs?: Record<string, number>; versions?: Record<string, number>; owner?: string },
): Promise<void> {
  if (ids.length === 0) return;
  const sentRevs = opts?.sentRevs ?? {};
  const versions = opts?.versions ?? {};
  const owner = opts?.owner;
  for (const id of ids) {
    await applyEntryResult(
      { id, owner: owner ?? getCurrentUserId() ?? "", local_rev: sentRevs[id] ?? 1, payload: dummyPayload(id) },
      { status: "updated", version: versions[id] },
    );
  }
}

export async function markError(
  ids: string[],
  error: string,
  opts?: { sentRevs?: Record<string, number>; owner?: string },
): Promise<void> {
  if (ids.length === 0) return;
  const owner = opts?.owner ?? getCurrentUserId() ?? "";
  for (const id of ids) {
    await applyEntryResult(
      { id, owner, local_rev: opts?.sentRevs?.[id] ?? 1, payload: dummyPayload(id) },
      { status: "error", reason: error },
    );
  }
}

export async function markRejected(
  items: { id: string; reason: string; conflict?: boolean }[],
  opts?: { sentRevs?: Record<string, number>; owner?: string; versions?: Record<string, number> },
): Promise<void> {
  if (items.length === 0) return;
  const owner = opts?.owner ?? getCurrentUserId() ?? "";
  for (const item of items) {
    await applyEntryResult(
      { id: item.id, owner, local_rev: opts?.sentRevs?.[item.id] ?? 1, payload: dummyPayload(item.id) },
      { status: item.conflict || item.reason === "version_mismatch" ? "conflict" : "rejected", reason: item.reason, version: opts?.versions?.[item.id] },
    );
  }
}

export async function getPendingForSync(limit = 50, userId?: string): Promise<PendingEntry[]> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return [];
  const test = getTestQueue();
  const rows = test
    ? [...test.entries.values()]
    : await getLifeDb().entries.where("status").anyOf(["pending", "error", "pending_delete"]).sortBy("queued_at");
  return rows
    .filter((r) => r.owner_user_id === owner && ["pending", "error", "pending_delete"].includes(r.status))
    .sort((a, b) => a.queued_at - b.queued_at)
    .slice(0, limit);
}

export async function countPending(userId?: string): Promise<number> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return 0;
  const rows = await getLifeDb().entries.where("status").anyOf(["pending", "error", "pending_delete"]).toArray();
  return rows.filter((r) => r.owner_user_id === owner).length;
}

export async function markPendingDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const owner = getCurrentUserId();
  if (!owner) return;
  const test = getTestQueue();
  const bump = (entry: PendingEntry) => {
    if (entry.owner_user_id !== owner) return entry;
    return {
      ...entry,
      status: "pending_delete" as const,
      deleted: true,
      last_attempt_at: Date.now(),
      local_rev: (entry.local_rev ?? 0) + 1,
    };
  };
  if (test) {
    for (const id of ids) {
      const row = test.entries.get(id);
      if (row) test.entries.set(id, bump(row));
    }
    return;
  }
  const store = getLifeDb();
  await store.transaction("rw", store.entries, async () => {
    for (const id of ids) {
      const row = await store.entries.get(id);
      if (!row || row.owner_user_id !== owner) continue;
      await store.entries.put(bump(row));
    }
  });
}

export async function ackDeletes(
  ids: string[],
  opts?: { sentRevs?: Record<string, number>; owner?: string; versions?: Record<string, number> },
): Promise<void> {
  const owner = opts?.owner ?? getCurrentUserId() ?? "";
  for (const id of ids) {
    await applyEntryResult(
      { id, owner, local_rev: opts?.sentRevs?.[id] ?? 1, payload: dummyPayload(id, true) },
      { status: "deleted", version: opts?.versions?.[id] },
    );
  }
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
  const store = getLifeDb();
  const rows = await store.entries.bulkGet(ids);
  for (const row of rows) {
    if (!row) continue;
    apply(row);
    await store.entries.put(row);
  }
  return sent;
}

export async function getEntryStatuses(ids: string[]): Promise<Record<string, QueueStatus>> {
  const rows = await getLifeDb().entries.bulkGet(ids);
  const out: Record<string, QueueStatus> = {};
  for (const row of rows) {
    if (row) out[row.id] = row.status;
  }
  return out;
}

export async function getRecentEntries(sinceMs: number): Promise<PendingEntry[]> {
  const owner = getCurrentUserId();
  const sinceIso = new Date(sinceMs).toISOString();
  const rows = await getLifeDb().entries.where("timestamp").above(sinceIso).toArray();
  if (!owner) return [];
  return rows.filter((r) => r.owner_user_id === owner);
}

export async function pruneSynced(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return getLifeDb().entries
    .where("status")
    .equals("synced")
    .and((e) => e.queued_at < cutoff)
    .delete();
}

export async function deleteLocalEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const owner = getCurrentUserId();
  if (!owner) return;
  const store = getLifeDb();
  const rows = await store.entries.bulkGet(ids);
  const mine = rows.filter((r): r is PendingEntry => Boolean(r && r.owner_user_id === owner));
  await store.entries.bulkDelete(mine.map((r) => r.id));
}

export async function listOrphanEntries(): Promise<PendingEntry[]> {
  const rows = await getLifeDb().entries.toArray();
  return rows.filter((r) => r.owner_user_id == null || r.owner_user_id === "");
}

export async function attachOrphansToUser(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let n = 0;
  await getLifeDb().entries
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
  const store = getLifeDb();
  const rows = await store.entries.bulkGet(ids);
  const orphans = rows.filter((r): r is PendingEntry => Boolean(r && !r.owner_user_id));
  await store.entries.bulkDelete(orphans.map((r) => r.id));
}

export async function persistServerEntries(items: EntryRead[], owner: string, store?: LifeLogDB): Promise<void> {
  const upsert = (existing: PendingEntry | undefined, item: EntryRead): PendingEntry | undefined => {
    if (existing && existing.status !== "synced") return existing;
    if (
      existing &&
      typeof existing.version === "number" &&
      typeof item.version === "number" &&
      item.version < existing.version
    ) {
      return existing;
    }
    return {
      ...item,
      owner_user_id: owner,
      status: "synced",
      queued_at: existing?.queued_at ?? Date.now(),
      attempts: 0,
      local_rev: existing?.local_rev ?? 0,
      version: item.version ?? existing?.version ?? undefined,
      created_at: existing?.created_at ?? item.created_at,
      cached_at: new Date().toISOString(),
    };
  };
  const { test, db: target } = resolveQueueAccess(store);
  if (test) {
    for (const item of items) {
      const next = upsert(test.entries.get(item.id), item);
      if (next) test.entries.set(item.id, next);
    }
    return;
  }
  if (!target) return;
  await target.transaction("rw", target.entries, async () => {
    for (const item of items) {
      const next = upsert(await target.entries.get(item.id), item);
      if (next) await target.entries.put(next);
    }
  });
}

/** Drop only explicit tombstone ids. A missing list-page id never deletes a local copy. */
export async function applyEntryTombstones(
  items: { id: string; version?: number }[],
  owner: string,
): Promise<void> {
  if (items.length === 0) return;
  const droppable = (row: PendingEntry | undefined, tombVersion?: number) => {
    if (!row || row.owner_user_id !== owner) return false;
    if (row.status === "pending" || row.status === "error" || row.status === "conflict") return false;
    if (typeof tombVersion === "number" && typeof row.version === "number" && tombVersion < row.version) return false;
    return row.status === "synced" || row.status === "pending_delete";
  };
  const test = getTestQueue();
  if (test) {
    for (const item of items) {
      const row = test.entries.get(item.id);
      if (droppable(row, item.version)) test.entries.delete(item.id);
    }
    return;
  }
  const store = getLifeDb();
  await store.transaction("rw", store.entries, async () => {
    for (const item of items) {
      const row = await store.entries.get(item.id);
      if (droppable(row, item.version)) await store.entries.delete(item.id);
    }
  });
}
