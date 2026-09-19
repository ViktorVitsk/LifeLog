import type { Table, Transaction } from "dexie";
import type { EntrySyncPayload } from "../lib/api.ts";
import type {
  LifeKind,
  LifeLogDB,
  LifeOp,
  LifeOpKind,
  LifeOpStatus,
  PendingEntry,
  PendingLife,
  QueueStatus,
} from "./offlineQueue.ts";

export type OutboxEntityKind = "entry" | "goal" | "memory" | "action" | "feedback";
export type OutboxOperationKind = "feedback_and_action" | "feedback_correction";

export interface OutboxRowBase {
  id: string;
  entity_id: string;
  operation_id?: string;
  owner_user_id: string | null;
  payload: Record<string, unknown>;
  local_rev: number;
  inflight_rev?: number;
  queued_at: number;
  last_error?: string;
}

export interface OutboxEntityRow extends OutboxRowBase {
  id: `entity:${OutboxEntityKind}:${string}`;
  record_type: "entity";
  kind: OutboxEntityKind;
  status: QueueStatus;
  server_version?: number;
  conflict_version?: number;
  server_snapshot?: Record<string, unknown>;
  created_at?: string;
  cached_at?: string;
  attempts?: number;
  last_attempt_at?: number;
}

export interface OutboxOperationRow extends OutboxRowBase {
  id: `operation:${string}`;
  record_type: "operation";
  kind: OutboxOperationKind;
  status: LifeOpStatus;
  created_at: number;
  session_id: number;
  submission_id: string;
  status_seq?: number;
  feedback_id: string;
  action_id: string;
  expected_action_version?: number | null;
  expected_action_local_rev?: number | null;
  feedback_local_rev?: number | null;
  action_local_rev?: number | null;
  feedback_acked?: boolean;
  action_acked?: boolean;
}

export type OutboxRow = OutboxEntityRow | OutboxOperationRow;

export const OUTBOX_STORE =
  "id, [owner_user_id+record_type+status], queued_at, kind, entity_id, operation_id, submission_id";

const LIFE_KINDS: LifeKind[] = ["goal", "memory", "action", "feedback"];
const OP_KINDS: OutboxOperationKind[] = ["feedback_and_action", "feedback_correction"];
const CLAIM_STATUSES: QueueStatus[] = ["pending", "error", "pending_delete"];

export function entityKey(kind: OutboxEntityKind, entityId: string): `entity:${OutboxEntityKind}:${string}` {
  return `entity:${kind}:${entityId}`;
}

export function operationKey(operationId: string): `operation:${string}` {
  return `operation:${operationId}`;
}

export function isOutboxEntity(row: OutboxRow | undefined): row is OutboxEntityRow {
  return row?.record_type === "entity";
}

export function isOutboxOperation(row: OutboxRow | undefined): row is OutboxOperationRow {
  return row?.record_type === "operation";
}

export function outboxTable(store: LifeLogDB | Transaction): Table<OutboxRow, string> {
  return ("outbox" in store ? store.outbox : store.table("outbox")) as Table<OutboxRow, string>;
}

export function entryToOutbox(row: PendingEntry): OutboxEntityRow {
  const payload: Record<string, unknown> = { ...row };
  delete payload.status;
  delete payload.queued_at;
  delete payload.last_attempt_at;
  delete payload.last_error;
  delete payload.attempts;
  delete payload.owner_user_id;
  delete payload.local_rev;
  delete payload.inflight_rev;
  delete payload.conflict_version;
  delete payload.created_at;
  delete payload.cached_at;
  return {
    id: entityKey("entry", row.id),
    record_type: "entity",
    kind: "entry",
    entity_id: row.id,
    owner_user_id: row.owner_user_id ?? null,
    payload,
    local_rev: row.local_rev ?? 0,
    inflight_rev: row.inflight_rev,
    queued_at: row.queued_at,
    last_error: row.last_error,
    status: row.status,
    server_version: row.version ?? undefined,
    conflict_version: row.conflict_version,
    created_at: row.created_at,
    cached_at: row.cached_at,
    attempts: row.attempts,
    last_attempt_at: row.last_attempt_at,
  };
}

export function outboxToEntry(row: OutboxEntityRow): PendingEntry {
  return {
    ...(row.payload as unknown as EntrySyncPayload),
    id: row.entity_id,
    status: row.status,
    queued_at: row.queued_at,
    last_attempt_at: row.last_attempt_at,
    last_error: row.last_error,
    attempts: row.attempts ?? 0,
    owner_user_id: row.owner_user_id ?? undefined,
    local_rev: row.local_rev,
    inflight_rev: row.inflight_rev,
    conflict_version: row.conflict_version,
    version: row.server_version ?? (typeof row.payload.version === "number" ? row.payload.version : undefined),
    created_at: row.created_at,
    cached_at: row.cached_at,
  };
}

export function lifeToOutbox(row: PendingLife): OutboxEntityRow {
  const created = typeof row.payload.created_at === "string" ? row.payload.created_at : undefined;
  const cached = typeof row.payload.cached_at === "string" ? row.payload.cached_at : undefined;
  return {
    id: entityKey(row.kind, row.id),
    record_type: "entity",
    kind: row.kind,
    entity_id: row.id,
    owner_user_id: row.owner_user_id ?? null,
    payload: { ...row.payload },
    local_rev: row.local_rev ?? 0,
    inflight_rev: row.inflight_rev,
    queued_at: row.queued_at,
    last_error: row.last_error,
    status: row.status,
    server_version: row.server_version,
    conflict_version: row.conflict_version,
    server_snapshot: row.server_snapshot,
    created_at: created,
    cached_at: cached,
  };
}

export function outboxToLife(row: OutboxEntityRow): PendingLife {
  return {
    id: row.entity_id,
    kind: row.kind as LifeKind,
    payload: { ...row.payload },
    status: row.status,
    owner_user_id: row.owner_user_id ?? "",
    queued_at: row.queued_at,
    last_error: row.last_error,
    local_rev: row.local_rev,
    inflight_rev: row.inflight_rev,
    server_version: row.server_version,
    conflict_version: row.conflict_version,
    server_snapshot: row.server_snapshot,
  };
}

export function opToOutbox(op: LifeOp): OutboxOperationRow {
  return {
    id: operationKey(op.id),
    record_type: "operation",
    kind: op.kind,
    entity_id: op.action_id,
    operation_id: op.id,
    owner_user_id: op.owner_user_id ?? null,
    payload: {
      feedback_payload: op.feedback_payload ?? null,
      action_payload: op.action_payload ?? null,
    },
    local_rev: op.status_seq ?? 0,
    queued_at: op.created_at,
    last_error: undefined,
    status: op.status,
    created_at: op.created_at,
    session_id: op.session_id,
    submission_id: op.submission_id,
    status_seq: op.status_seq,
    feedback_id: op.feedback_id,
    action_id: op.action_id,
    expected_action_version: op.expected_action_version,
    expected_action_local_rev: op.expected_action_local_rev,
    feedback_local_rev: op.feedback_local_rev,
    action_local_rev: op.action_local_rev,
    feedback_acked: op.feedback_acked,
    action_acked: op.action_acked,
  };
}

export function outboxToOp(row: OutboxOperationRow): LifeOp {
  const feedback = row.payload.feedback_payload;
  const action = row.payload.action_payload;
  return {
    id: row.operation_id ?? row.id.slice("operation:".length),
    owner_user_id: row.owner_user_id ?? "",
    session_id: row.session_id,
    kind: row.kind as LifeOpKind,
    status: row.status,
    submission_id: row.submission_id,
    feedback_id: row.feedback_id,
    action_id: row.action_id,
    expected_action_version: row.expected_action_version,
    expected_action_local_rev: row.expected_action_local_rev,
    feedback_local_rev: row.feedback_local_rev,
    action_local_rev: row.action_local_rev,
    feedback_acked: row.feedback_acked,
    action_acked: row.action_acked,
    feedback_payload: (feedback as Record<string, unknown> | null | undefined) ?? null,
    action_payload: (action as Record<string, unknown> | null | undefined) ?? null,
    created_at: row.created_at,
    status_seq: row.status_seq ?? row.local_rev,
  };
}

function asPendingEntry(row: unknown): PendingEntry {
  return row as PendingEntry;
}

function asPendingLife(row: unknown): PendingLife {
  return row as PendingLife;
}

function asLifeOp(row: unknown): LifeOp {
  const raw = row as LifeOp & { intent_key?: string; submission_id?: string; id: string };
  const submission_id =
    typeof raw.submission_id === "string" && raw.submission_id ? raw.submission_id : String(raw.id ?? "");
  const kind: LifeOpKind = raw.kind === "feedback_correction" ? "feedback_correction" : "feedback_and_action";
  return { ...raw, submission_id, kind };
}

export async function copyLegacyToOutbox(tx: Transaction): Promise<void> {
  const outbox = tx.table("outbox") as Table<OutboxRow, string>;
  const entries = await tx.table("entries").toArray();
  const life = await tx.table("life_queue").toArray();
  const ops = await tx.table("life_ops").toArray();

  for (const row of entries) {
    await outbox.put(entryToOutbox(asPendingEntry(row)));
  }
  for (const row of life) {
    await outbox.put(lifeToOutbox(asPendingLife(row)));
  }
  for (const row of ops) {
    await outbox.put(opToOutbox(asLifeOp(row)));
  }

  const copied = await outbox.count();
  if (copied !== entries.length + life.length + ops.length) {
    throw new Error("outbox_copy_count_mismatch");
  }

  for (const raw of ops) {
    const op = asLifeOp(raw);
    const stored = await outbox.get(operationKey(op.id));
    if (!isOutboxOperation(stored)) throw new Error("outbox_op_missing");
    if (stored.submission_id !== op.submission_id) throw new Error("outbox_submission_mismatch");
    if (stored.status !== op.status) throw new Error("outbox_status_mismatch");
    if (stored.status_seq !== op.status_seq && (stored.status_seq ?? stored.local_rev) !== (op.status_seq ?? 0)) {
      throw new Error("outbox_status_seq_mismatch");
    }
    if (stored.created_at !== op.created_at) throw new Error("outbox_created_at_mismatch");
    if (stored.feedback_id !== op.feedback_id || stored.action_id !== op.action_id) {
      throw new Error("outbox_op_ids_mismatch");
    }
    if (stored.feedback_acked !== op.feedback_acked || stored.action_acked !== op.action_acked) {
      throw new Error("outbox_ack_flags_mismatch");
    }
    if (JSON.stringify(stored.payload.feedback_payload ?? null) !== JSON.stringify(op.feedback_payload ?? null)) {
      throw new Error("outbox_feedback_snapshot_mismatch");
    }
    if (JSON.stringify(stored.payload.action_payload ?? null) !== JSON.stringify(op.action_payload ?? null)) {
      throw new Error("outbox_action_snapshot_mismatch");
    }
  }
}

export async function getOutboxEntityById(store: LifeLogDB, entityId: string): Promise<OutboxEntityRow | undefined> {
  const rows = await outboxTable(store).where("entity_id").equals(entityId).toArray();
  return rows.find(isOutboxEntity);
}

export async function getEntry(store: LifeLogDB, id: string): Promise<PendingEntry | undefined> {
  const row = await outboxTable(store).get(entityKey("entry", id));
  return isOutboxEntity(row) ? outboxToEntry(row) : undefined;
}

export async function putEntry(store: LifeLogDB, row: PendingEntry): Promise<void> {
  await outboxTable(store).put(entryToOutbox(row));
}

export async function deleteEntry(store: LifeLogDB, id: string): Promise<void> {
  await outboxTable(store).delete(entityKey("entry", id));
}

export async function listEntries(store: LifeLogDB): Promise<PendingEntry[]> {
  const rows = await outboxTable(store).where("kind").equals("entry").toArray();
  return rows.filter(isOutboxEntity).map(outboxToEntry);
}

export async function getLife(store: LifeLogDB, id: string): Promise<PendingLife | undefined> {
  const row = await getOutboxEntityById(store, id);
  if (!row || row.kind === "entry") return undefined;
  return outboxToLife(row);
}

export async function putLife(store: LifeLogDB, row: PendingLife): Promise<void> {
  await outboxTable(store).put(lifeToOutbox(row));
}

export async function deleteLife(store: LifeLogDB, id: string): Promise<void> {
  const row = await getOutboxEntityById(store, id);
  if (row && row.kind !== "entry") await outboxTable(store).delete(row.id);
}

export async function listLife(store: LifeLogDB): Promise<PendingLife[]> {
  const rows = await outboxTable(store).where("kind").anyOf(LIFE_KINDS).toArray();
  return rows.filter(isOutboxEntity).map(outboxToLife);
}

export async function getOp(store: LifeLogDB, id: string): Promise<LifeOp | undefined> {
  const row = await outboxTable(store).get(operationKey(id));
  return isOutboxOperation(row) ? outboxToOp(row) : undefined;
}

export async function putOp(store: LifeLogDB, op: LifeOp): Promise<void> {
  await outboxTable(store).put(opToOutbox(op));
}

export async function listOps(store: LifeLogDB, owner?: string): Promise<LifeOp[]> {
  const rows = await outboxTable(store).where("kind").anyOf(OP_KINDS).toArray();
  return rows
    .filter(isOutboxOperation)
    .map(outboxToOp)
    .filter((op) => (owner == null ? true : op.owner_user_id === owner));
}

export async function listOwnedEntries(store: LifeLogDB, owner: string): Promise<PendingEntry[]> {
  return (await listEntries(store)).filter((row) => row.owner_user_id === owner);
}

export async function listOwnedLife(store: LifeLogDB, owner: string): Promise<PendingLife[]> {
  return (await listLife(store)).filter((row) => row.owner_user_id === owner);
}

export async function claimEntityRows(
  store: LifeLogDB,
  owner: string,
  kinds: OutboxEntityKind[],
  limit = Number.POSITIVE_INFINITY,
): Promise<OutboxEntityRow[]> {
  const snapshots: OutboxEntityRow[] = [];
  const table = outboxTable(store);
  await store.transaction("rw", table, async () => {
    const rows = (await table.where("kind").anyOf(kinds).toArray())
      .filter(isOutboxEntity)
      .filter((row) => row.owner_user_id === owner && CLAIM_STATUSES.includes(row.status))
      .sort((a, b) => a.queued_at - b.queued_at);
    for (const row of rows) {
      if (snapshots.length >= limit) break;
      const local_rev = row.local_rev ?? 1;
      const next: OutboxEntityRow = { ...row, inflight_rev: local_rev };
      await table.put(next);
      snapshots.push({ ...next, payload: { ...next.payload } });
    }
  });
  return snapshots;
}
