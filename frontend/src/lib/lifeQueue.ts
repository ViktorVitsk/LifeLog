import { captureSaveScope, type SaveScope } from "./accountScope.ts";
import { encryptEntry } from "./crypto.ts";
import { db, type LifeKind, type PendingLife } from "../db/offlineQueue.ts";
import { getTestQueue } from "../db/testQueue.ts";

export function nextLifeEnqueue(
  existing: PendingLife | undefined,
  kind: LifeKind,
  payload: Record<string, unknown>,
  owner: string,
): PendingLife {
  return {
    id: String(payload.id),
    kind,
    payload,
    status: payload.deleted ? "pending_delete" : "pending",
    owner_user_id: owner,
    queued_at: Date.now(),
    local_rev: (existing?.local_rev ?? 0) + 1,
    inflight_rev: existing?.inflight_rev,
    server_version: existing?.server_version,
    last_error: undefined,
  };
}

export function applyLifeAck(
  row: PendingLife,
  sentRev: number,
  result: { status: string; reason?: string | null; version?: number | null },
): PendingLife {
  const next = { ...row };
  if ((row.local_rev ?? 1) !== sentRev) {
    next.inflight_rev = undefined;
    if (result.version != null) next.server_version = result.version;
    if (next.status === "synced") next.status = "pending";
    return next;
  }
  if (result.status === "created" || result.status === "duplicate" || result.status === "updated") {
    next.status = "synced";
    next.inflight_rev = undefined;
    if (result.version != null) next.server_version = result.version;
    next.last_error = undefined;
    return next;
  }
  if (result.status === "conflict") {
    next.status = "conflict";
    next.inflight_rev = undefined;
    next.last_error = result.reason ?? "conflict";
    return next;
  }
  if (result.status === "rejected") {
    next.status = "rejected";
    next.inflight_rev = undefined;
    next.last_error = result.reason ?? result.status;
    return next;
  }
  if (result.status === "deleted") {
    next.status = "synced";
    next.inflight_rev = undefined;
    if (result.version != null) next.server_version = result.version;
    return next;
  }
  next.inflight_rev = undefined;
  return next;
}

async function readLife(id: string): Promise<PendingLife | undefined> {
  const test = getTestQueue();
  if (test) return test.life.get(id);
  return db.life_queue.get(id);
}

export async function writeLife(row: PendingLife): Promise<void> {
  const test = getTestQueue();
  if (test) {
    test.life.set(row.id, row);
    return;
  }
  await db.life_queue.put(row);
}

export async function enqueueLife(
  kind: LifeKind,
  payload: Record<string, unknown>,
  scope?: SaveScope,
): Promise<void> {
  const owner = scope?.owner ?? captureSaveScope().owner;
  const id = String(payload.id);
  const existing = await readLife(id);
  await writeLife(nextLifeEnqueue(existing, kind, payload, owner));
}

export async function getPendingLife(userId: string): Promise<PendingLife[]> {
  const test = getTestQueue();
  const rows = test
    ? [...test.life.values()]
    : await db.life_queue.where("status").anyOf(["pending", "error", "pending_delete"]).toArray();
  return rows.filter(
    (row) =>
      row.owner_user_id === userId &&
      (row.status === "pending" || row.status === "error" || row.status === "pending_delete"),
  );
}

export async function listOwnedLife(userId: string): Promise<PendingLife[]> {
  const test = getTestQueue();
  const rows = test ? [...test.life.values()] : await db.life_queue.toArray();
  return rows.filter((row) => row.owner_user_id === userId);
}

export async function readLifeRow(id: string): Promise<PendingLife | undefined> {
  return readLife(id);
}

export function lifeSyncPayload(row: PendingLife): Record<string, unknown> {
  const payload = { ...row.payload };
  delete payload.scope;
  return {
    ...payload,
    deleted: row.status === "pending_delete" || payload.deleted === true,
    version: row.server_version ?? (typeof payload.version === "number" ? payload.version : undefined),
  };
}

export async function applyLifeTombstones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const droppable = (row: PendingLife | undefined) =>
    Boolean(row && (row.status === "synced" || row.status === "pending_delete"));
  const test = getTestQueue();
  if (test) {
    for (const id of ids) {
      const row = test.life.get(id);
      if (droppable(row)) test.life.delete(id);
    }
    return;
  }
  const rows = await db.life_queue.bulkGet(ids);
  await db.life_queue.bulkDelete(rows.filter((row): row is PendingLife => droppable(row)).map((row) => row.id));
}

export async function encryptLifePayload(
  kek: CryptoKey,
  body: Record<string, unknown>,
  opts?: { afterEncrypt?: () => Promise<void>; scope?: SaveScope },
): Promise<{ encrypted_dek: string; encrypted_content: string; scope: SaveScope }> {
  const scope = opts?.scope ?? captureSaveScope();
  const { encryptedContent, encryptedDek } = await encryptEntry(JSON.stringify(body), kek);
  if (opts?.afterEncrypt) await opts.afterEncrypt();
  return { encrypted_content: encryptedContent, encrypted_dek: encryptedDek, scope };
}
