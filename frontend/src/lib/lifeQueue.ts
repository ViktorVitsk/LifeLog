import { captureSaveScope, type SaveScope } from "./accountScope.ts";
import { firstKnownIso, isStaleVersion, knownIso, nowIso } from "./cacheFreshness.ts";
import { encryptEntry } from "./crypto.ts";
import { db, type LifeKind, type PendingLife } from "../db/offlineQueue.ts";
import { getTestQueue } from "../db/testQueue.ts";
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
  const test = getTestQueue();
  if (test) {
    test.life.set(id, nextLifeEnqueue(test.life.get(id), kind, payload, owner));
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    const existing = await db.life_queue.get(id);
    await db.life_queue.put(nextLifeEnqueue(existing, kind, payload, owner));
  });
}

export async function deleteLifeRow(id: string, owner: string): Promise<void> {
  const test = getTestQueue();
  if (test) {
    const row = test.life.get(id);
    if (row && row.owner_user_id === owner) test.life.delete(id);
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    const row = await db.life_queue.get(id);
    if (row && row.owner_user_id === owner) await db.life_queue.delete(id);
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

export async function claimLifeForSend(userId: string): Promise<LifeSendSnapshot[]> {
  const snapshots: LifeSendSnapshot[] = [];
  const test = getTestQueue();
  const mark = (row: PendingLife) => {
    if (row.owner_user_id !== userId) return;
    if (!["pending", "error", "pending_delete"].includes(row.status)) return;
    const local_rev = row.local_rev ?? 1;
    row.inflight_rev = local_rev;
    snapshots.push({
      id: row.id,
      owner: row.owner_user_id,
      kind: row.kind,
      local_rev,
      payload: { ...row.payload },
      server_version: row.server_version,
      status: row.status,
    });
  };
  if (test) {
    for (const row of test.life.values()) mark(row);
    return snapshots;
  }
  await db.transaction("rw", db.life_queue, async () => {
    const rows = await db.life_queue
      .where("status")
      .anyOf(["pending", "error", "pending_delete"])
      .toArray();
    for (const row of rows) {
      if (row.owner_user_id !== userId) continue;
      const local_rev = row.local_rev ?? 1;
      row.inflight_rev = local_rev;
      await db.life_queue.put(row);
      snapshots.push({
        id: row.id,
        owner: row.owner_user_id,
        kind: row.kind,
        local_rev,
        payload: { ...row.payload },
        server_version: row.server_version,
        status: row.status,
      });
    }
  });
  return snapshots;
}

export async function applyLifeResult(
  snapshot: LifeSendSnapshot,
  result: { status: string; reason?: string | null; version?: number | null },
): Promise<void> {
  const test = getTestQueue();
  const apply = (row: PendingLife | undefined) => {
    if (!row) return { drop: false as const, next: undefined };
    const out = applyLifeAck(row, { owner: snapshot.owner, local_rev: snapshot.local_rev }, result);
    return { drop: out.drop, next: out.ignored ? undefined : out.row };
  };
  if (test) {
    const out = apply(test.life.get(snapshot.id));
    if (out.drop) test.life.delete(snapshot.id);
    else if (out.next) test.life.set(snapshot.id, out.next);
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    const row = await db.life_queue.get(snapshot.id);
    const out = apply(row);
    if (out.drop) await db.life_queue.delete(snapshot.id);
    else if (out.next) await db.life_queue.put(out.next);
  });
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

export async function applyLifeTombstones(
  items: { id: string; version?: number }[],
  owner: string,
): Promise<void> {
  if (items.length === 0) return;
  const droppable = (row: PendingLife | undefined, tombVersion?: number) => {
    if (!row || row.owner_user_id !== owner) return false;
    if (row.status === "pending" || row.status === "error" || row.status === "conflict") return false;
    if (isStaleVersion(tombVersion, row.server_version)) return false;
    return row.status === "synced" || row.status === "pending_delete";
  };
  const test = getTestQueue();
  if (test) {
    for (const item of items) {
      const row = test.life.get(item.id);
      if (droppable(row, item.version)) test.life.delete(item.id);
    }
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    for (const item of items) {
      const row = await db.life_queue.get(item.id);
      if (droppable(row, item.version)) await db.life_queue.delete(item.id);
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

export async function persistServerLife(bundle: LifeBundle, owner: string): Promise<void> {
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
  const test = getTestQueue();
  if (test) {
    for (const [kind, items] of groups) {
      for (const item of items as (LifeGoalRead | LifeMemoryRead | LifeActionRead | LifeFeedbackRead)[]) {
        test.life.set(item.id, upsert(test.life.get(item.id), kind, item));
      }
    }
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    for (const [kind, items] of groups) {
      for (const item of items as (LifeGoalRead | LifeMemoryRead | LifeActionRead | LifeFeedbackRead)[]) {
        const existing = await db.life_queue.get(item.id);
        await db.life_queue.put(upsert(existing, kind, item));
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
  const test = getTestQueue();
  if (test) {
    const next = apply(test.life.get(id));
    if (next) test.life.set(id, next);
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    const next = apply(await db.life_queue.get(id));
    if (next) await db.life_queue.put(next);
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
  const test = getTestQueue();
  if (test) {
    const next = apply(test.life.get(id));
    if (next) test.life.set(id, next);
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    const next = apply(await db.life_queue.get(id));
    if (next) await db.life_queue.put(next);
  });
}

export async function resolveLifeKeepLocalCopy(id: string, owner: string, copyId: string): Promise<void> {
  const test = getTestQueue();
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
  if (test) {
    for (const row of split(test.life.get(id))) test.life.set(row.id, row);
    return;
  }
  await db.transaction("rw", db.life_queue, async () => {
    for (const row of split(await db.life_queue.get(id))) await db.life_queue.put(row);
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
