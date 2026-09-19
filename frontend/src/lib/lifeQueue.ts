import {
  claimEntityRows,
  deleteLife,
  getLife,
  listLife,
  listOwnedLife as listOwnedLifeRows,
  putLife,
} from "../db/outbox.ts";
import { captureSaveScope, type SaveScope } from "./accountScope.ts";
import { firstKnownIso, isStaleVersion, knownIso, nowIso } from "./cacheFreshness.ts";
import { encryptEntry } from "./crypto.ts";
import { ackLifeOpsForResult, getLifeDb, resolveQueueAccess, type LifeKind, type LifeLogDB, type PendingLife } from "../db/offlineQueue.ts";
import { ackKindFromStatus, applyRevisionAck } from "./queueAck.ts";
import type { LifeActionRead, LifeBundle, LifeFeedbackRead, LifeGoalRead, LifeMemoryRead } from "./api.ts";

export function nextLifeEnqueue(
  existing: PendingLife | undefined,
  kind: LifeKind,
  payload: Record<string, unknown>,
  owner: string,
): PendingLife {
  const edited = Date.now();
  const created = firstKnownIso(existing?.payload.created_at, payload.created_at) ?? nowIso(edited);
  return {
    id: String(payload.id),
    kind,
    payload: {
      ...payload,
      created_at: created,
      updated_at: knownIso(payload.updated_at) ?? nowIso(edited),
      cached_at: existing?.payload.cached_at,
    },
    status: payload.deleted ? "pending_delete" : "pending",
    owner_user_id: owner,
    queued_at: edited,
    local_rev: (existing?.local_rev ?? 0) + 1,
    inflight_rev: existing?.inflight_rev,
    server_version: existing?.server_version,
    conflict_version: existing?.conflict_version,
    server_snapshot: existing?.server_snapshot,
    last_error: undefined,
  };
}

export function applyLifeAck(
  row: PendingLife,
  sent: { owner: string; local_rev: number } | number,
  result: { status: string; reason?: string | null; version?: number | null },
): { row: PendingLife; drop: boolean; ignored: boolean } {
  const sentMeta = typeof sent === "number" ? { owner: row.owner_user_id, local_rev: sent } : sent;
  const asRev = {
    local_rev: row.local_rev,
    inflight_rev: row.inflight_rev,
    server_version: row.server_version,
    status: row.status,
    last_error: row.last_error,
    conflict_version: row.conflict_version,
    owner_user_id: row.owner_user_id,
  };
  const out = applyRevisionAck(asRev, sentMeta, {
    kind: ackKindFromStatus(result.status),
    version: result.version,
    reason: result.reason,
  });
  return {
    row: {
      ...row,
      local_rev: out.row.local_rev,
      inflight_rev: out.row.inflight_rev,
      server_version: out.row.server_version,
      status: out.row.status,
      last_error: out.row.last_error,
      conflict_version: out.row.conflict_version,
    },
    drop: out.drop,
    ignored: out.ignored,
  };
}

async function readLife(id: string, store?: LifeLogDB): Promise<PendingLife | undefined> {
  const { db } = resolveQueueAccess(store);
  return getLife(db, id);
}

export async function writeLife(row: PendingLife, store?: LifeLogDB): Promise<void> {
  const { db } = resolveQueueAccess(store);
  await putLife(db, row);
}

export async function enqueueLife(
  kind: LifeKind,
  payload: Record<string, unknown>,
  scope?: SaveScope,
  store?: LifeLogDB,
): Promise<void> {
  const owner = scope?.owner ?? captureSaveScope().owner;
  const id = String(payload.id);
  const { db } = resolveQueueAccess(store);
  await db.transaction("rw", db.outbox, async () => {
    const existing = await getLife(db, id);
    await putLife(db, nextLifeEnqueue(existing, kind, payload, owner));
  });
}

export async function deleteLifeRow(id: string, owner: string): Promise<void> {
  const store = getLifeDb();
  await store.transaction("rw", store.outbox, async () => {
    const row = await getLife(store, id);
    if (row && row.owner_user_id === owner) await deleteLife(store, id);
  });
}

export interface LifeSendSnapshot {
  id: string;
  owner: string;
  kind: LifeKind;
  local_rev: number;
  payload: Record<string, unknown>;
  server_version?: number;
  status: PendingLife["status"];
}

export async function claimLifeForSend(userId: string, store?: LifeLogDB): Promise<LifeSendSnapshot[]> {
  const { db } = resolveQueueAccess(store);
  const rows = await claimEntityRows(db, userId, ["goal", "memory", "action", "feedback"]);
  return rows.map((row) => ({
    id: row.entity_id,
    owner: row.owner_user_id ?? userId,
    kind: row.kind as LifeKind,
    local_rev: row.local_rev ?? 1,
    payload: { ...row.payload },
    server_version: row.server_version,
    status: row.status,
  }));
}

export async function applyLifeResult(
  snapshot: LifeSendSnapshot,
  result: { status: string; reason?: string | null; version?: number | null },
  store?: LifeLogDB,
): Promise<void> {
  const { db } = resolveQueueAccess(store);
  const apply = (row: PendingLife | undefined) => {
    if (!row) return { drop: false as const, next: undefined };
    const out = applyLifeAck(row, { owner: snapshot.owner, local_rev: snapshot.local_rev }, result);
    return { drop: out.drop, next: out.ignored ? undefined : out.row };
  };
  await db.transaction("rw", db.outbox, async () => {
    const row = await getLife(db, snapshot.id);
    const out = apply(row);
    if (out.drop) await deleteLife(db, snapshot.id);
    else if (out.next) await putLife(db, out.next);
    await ackLifeOpsForResult(snapshot.id, snapshot.local_rev, result, db);
  });
}

export async function getPendingLife(userId: string): Promise<PendingLife[]> {
  const rows = await listLife(getLifeDb());
  return rows.filter(
    (row) =>
      row.owner_user_id === userId &&
      (row.status === "pending" || row.status === "error" || row.status === "pending_delete"),
  );
}

export async function listOwnedLife(userId: string): Promise<PendingLife[]> {
  return listOwnedLifeRows(getLifeDb(), userId);
}

export async function readLifeRow(id: string, store?: LifeLogDB): Promise<PendingLife | undefined> {
  return readLife(id, store);
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

export async function applyLifeTombstones(
  items: { id: string; version?: number }[],
  owner: string,
  store?: LifeLogDB,
): Promise<void> {
  if (items.length === 0) return;
  const droppable = (row: PendingLife | undefined, tombVersion?: number) => {
    if (!row || row.owner_user_id !== owner) return false;
    if (row.status === "pending" || row.status === "error" || row.status === "conflict") return false;
    if (isStaleVersion(tombVersion, row.server_version)) return false;
    return row.status === "synced" || row.status === "pending_delete";
  };
  const { db } = resolveQueueAccess(store);
  await db.transaction("rw", db.outbox, async () => {
    for (const item of items) {
      const row = await getLife(db, item.id);
      if (droppable(row, item.version)) await deleteLife(db, item.id);
    }
  });
}

function entityPayload(kind: LifeKind, item: LifeGoalRead | LifeMemoryRead | LifeActionRead | LifeFeedbackRead): Record<string, unknown> {
  const base = {
    id: item.id,
    encrypted_dek: item.encrypted_dek,
    encrypted_content: item.encrypted_content,
    version: item.version,
    created_at: item.created_at,
    updated_at: item.updated_at,
    cached_at: nowIso(),
  };
  if (kind === "goal") {
    const g = item as LifeGoalRead;
    return { ...base, state: g.state, review_at: g.review_at ?? null, habit_ids: g.habit_ids ?? [], skill_ids: g.skill_ids ?? [], entry_ids: g.entry_ids ?? [] };
  }
  if (kind === "memory") {
    const m = item as LifeMemoryRead;
    return { ...base, kind: m.kind, state: m.state, origin: m.origin ?? "user", reviewed_at: m.reviewed_at ?? null, entry_ids: m.entry_ids ?? [] };
  }
  if (kind === "action") {
    const a = item as LifeActionRead;
    return {
      ...base,
      goal_id: a.goal_id,
      state: a.state,
      result_metric: a.result_metric ?? null,
      period_start: a.period_start ?? null,
      period_end: a.period_end ?? null,
      review_at: a.review_at ?? null,
    };
  }
  const f = item as LifeFeedbackRead;
  return { ...base, action_id: f.action_id, outcome_kind: f.outcome_kind };
}

function asCacheRow(kind: LifeKind, item: LifeGoalRead | LifeMemoryRead | LifeActionRead | LifeFeedbackRead, owner: string, existing?: PendingLife): PendingLife {
  return {
    id: item.id,
    kind,
    payload: entityPayload(kind, item),
    status: "synced",
    owner_user_id: owner,
    queued_at: existing?.queued_at ?? Date.now(),
    local_rev: existing?.local_rev ?? 0,
    server_version: item.version,
    last_error: undefined,
  };
}

export async function persistServerLife(bundle: LifeBundle, owner: string, store?: LifeLogDB): Promise<void> {
  const groups: [LifeKind, { id: string }[]][] = [
    ["goal", bundle.goals],
    ["memory", bundle.memory],
    ["action", bundle.actions],
    ["feedback", bundle.feedback],
  ];
  const upsert = (existing: PendingLife | undefined, kind: LifeKind, item: LifeGoalRead | LifeMemoryRead | LifeActionRead | LifeFeedbackRead): PendingLife => {
    if (existing && isStaleVersion(item.version, existing.server_version)) return existing;
    const payload = entityPayload(kind, item);
    if (!existing) return asCacheRow(kind, item, owner);
    if (existing.status === "synced") {
      return {
        ...existing,
        payload: {
          ...payload,
          created_at: firstKnownIso(existing.payload.created_at, item.created_at) ?? payload.created_at,
        },
        server_version: item.version,
        last_error: undefined,
      };
    }
    if (existing.status === "pending_delete") return existing;
    return { ...existing, server_snapshot: payload, conflict_version: item.version ?? existing.conflict_version };
  };
  const { db } = resolveQueueAccess(store);
  await db.transaction("rw", db.outbox, async () => {
    for (const [kind, items] of groups) {
      for (const item of items as (LifeGoalRead | LifeMemoryRead | LifeActionRead | LifeFeedbackRead)[]) {
        const existing = await getLife(db, item.id);
        await putLife(db, upsert(existing, kind, item));
      }
    }
  });
}

export async function resolveLifeKeepServer(id: string, owner: string): Promise<void> {
  const apply = (row: PendingLife | undefined) => {
    if (!row || row.owner_user_id !== owner || !row.server_snapshot) return row;
    return {
      ...row,
      payload: row.server_snapshot,
      status: "synced" as const,
      server_version: row.conflict_version ?? row.server_version,
      last_error: undefined,
      conflict_version: undefined,
      server_snapshot: undefined,
    };
  };
  await getLifeDb().transaction("rw", getLifeDb().outbox, async () => {
    const next = apply(await getLife(getLifeDb(), id));
    if (next) await putLife(getLifeDb(), next);
  });
}

export async function resolveLifeApplyLocal(id: string, owner: string): Promise<void> {
  const apply = (row: PendingLife | undefined) => {
    if (!row || row.owner_user_id !== owner) return row;
    const base = row.conflict_version ?? (typeof row.server_snapshot?.version === "number" ? row.server_snapshot.version : row.server_version);
    return {
      ...row,
      status: "pending" as const,
      server_version: base,
      last_error: undefined,
      local_rev: (row.local_rev ?? 0) + 1,
    };
  };
  await getLifeDb().transaction("rw", getLifeDb().outbox, async () => {
    const next = apply(await getLife(getLifeDb(), id));
    if (next) await putLife(getLifeDb(), next);
  });
}

export async function resolveLifeKeepLocalCopy(id: string, owner: string, copyId: string): Promise<void> {
  const split = (row: PendingLife | undefined): PendingLife[] => {
    if (!row || row.owner_user_id !== owner) return [];
    const copy = nextLifeEnqueue(undefined, row.kind, { ...row.payload, id: copyId }, owner);
    const kept = row.server_snapshot
      ? {
          ...row,
          payload: row.server_snapshot,
          status: "synced" as const,
          server_version: row.conflict_version ?? row.server_version,
          last_error: undefined,
          conflict_version: undefined,
          server_snapshot: undefined,
        }
      : row;
    return [kept, copy];
  };
  await getLifeDb().transaction("rw", getLifeDb().outbox, async () => {
    for (const row of split(await getLife(getLifeDb(), id))) await putLife(getLifeDb(), row);
  });
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
