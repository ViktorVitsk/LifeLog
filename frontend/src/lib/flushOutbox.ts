import { applyEntryResult, db, toEntryPayload, type EntrySendSnapshot, type LifeKind, type PendingEntry, type PendingLife, type QueueStatus } from "../db/offlineQueue.ts";
import { claimEntityRows, getEntry, getLife } from "../db/outbox.ts";
import { api, isAuthError, isNetworkError, type LifeSyncResponse } from "./api.ts";
import {
  applyLifeResult,
  lifeSyncPayload,
  type LifeSendSnapshot,
} from "./lifeQueue.ts";
import { withSyncLock } from "./syncLock.ts";
import { planQueueUpdates } from "../sync/syncContract.ts";

export interface OutboxFlushResult {
  attempted: number;
  saved: number;
  failed: number;
  deleted?: number;
  error?: string;
}

async function applyLifePlan(resp: LifeSyncResponse, sent: LifeSendSnapshot[]): Promise<void> {
  const byId = new Map(sent.map((item) => [item.id, item]));
  const plan = planQueueUpdates(resp, sent.map((item) => item.id));
  const ids = new Set([...plan.markSynced, ...plan.markRejected.map((r) => r.id), ...plan.ackDelete, ...plan.leavePending]);
  for (const id of ids) {
    const snapshot = byId.get(id);
    if (!snapshot) continue;
    const result = resp.results.find((item) => item.id === id) ?? {
      id,
      status: plan.ackDelete.includes(id) ? "deleted" : plan.markSynced.includes(id) ? "updated" : "error",
    };
    await applyLifeResult(snapshot, result);
  }
}

async function flushKind(
  kind: LifeKind,
  snapshots: LifeSendSnapshot[],
  send: (items: Record<string, unknown>[]) => Promise<LifeSyncResponse>,
): Promise<number> {
  const rows = snapshots.filter((row) => row.kind === kind);
  if (!rows.length) return 0;
  const resp = await send(
    rows.map((row) =>
      lifeSyncPayload({
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        status: row.status,
        owner_user_id: row.owner,
        queued_at: 0,
        local_rev: row.local_rev,
        server_version: row.server_version,
      }),
    ),
  );
  await applyLifePlan(resp, rows);
  return resp.saved.length;
}

async function flushLifeKindsTracked(
  token: string,
  snapshots: LifeSendSnapshot[],
  tally: { saved: number },
): Promise<void> {
  if (!snapshots.length) return;
  tally.saved += await flushKind("goal", snapshots, (items) => api.syncLifeGoals(token, items as never));
  tally.saved += await flushKind("memory", snapshots, (items) => api.syncLifeMemory(token, items as never));
  tally.saved += await flushKind("action", snapshots, (items) => api.syncLifeActions(token, items as never));
  tally.saved += await flushKind("feedback", snapshots, (items) => api.syncLifeFeedback(token, items as never));
}

export async function flushLifeKinds(token: string, snapshots: LifeSendSnapshot[]): Promise<number> {
  const tally = { saved: 0 };
  await flushLifeKindsTracked(token, snapshots, tally);
  return tally.saved;
}

async function applyEntrySnapshots(
  snapshots: EntrySendSnapshot[],
  results: { id: string; status: string; reason?: string | null; version?: number | null }[],
): Promise<{ saved: number; failed: number; deleted: number }> {
  const byId = new Map(results.map((row) => [row.id, row]));
  let saved = 0;
  let failed = 0;
  let deleted = 0;
  for (const snap of snapshots) {
    const result = byId.get(snap.id) ?? { id: snap.id, status: "error", reason: "missing_result" };
    await applyEntryResult(snap, result);
    if (result.status === "created" || result.status === "duplicate" || result.status === "updated") saved += 1;
    else if (result.status === "deleted") deleted += 1;
    else if (result.status === "conflict" || result.status === "rejected") failed += 1;
  }
  return { saved, failed, deleted };
}

function alreadyAcked(status: QueueStatus | undefined): boolean {
  return status === "synced" || status === "conflict" || status === "rejected";
}

function asLifeSnapshot(row: {
  entity_id: string;
  owner_user_id: string | null;
  kind: string;
  local_rev: number;
  payload: Record<string, unknown>;
  server_version?: number;
  status: PendingLife["status"];
}): LifeSendSnapshot {
  return {
    id: row.entity_id,
    owner: row.owner_user_id ?? "",
    kind: row.kind as LifeKind,
    local_rev: row.local_rev ?? 1,
    payload: { ...row.payload },
    server_version: row.server_version,
    status: row.status,
  };
}

export async function flushOutboxUnlocked(token: string, userId: string): Promise<OutboxFlushResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { attempted: 0, saved: 0, failed: 0, error: "offline" };
  }
  const claimed = await claimEntityRows(db, userId, ["entry", "goal", "memory", "action", "feedback"]);
  const entryRows = claimed.filter((row) => row.kind === "entry");
  const lifeRows = claimed.filter((row) => row.kind !== "entry").map(asLifeSnapshot);
  const entrySnaps: EntrySendSnapshot[] = entryRows.map((row) => ({
    id: row.entity_id,
    owner: row.owner_user_id ?? userId,
    local_rev: row.local_rev ?? 1,
    payload: toEntryPayload({
      ...(row.payload as unknown as EntrySendSnapshot["payload"]),
      id: row.entity_id,
      status: row.status,
      queued_at: row.queued_at,
      attempts: row.attempts ?? 0,
      owner_user_id: row.owner_user_id ?? undefined,
      local_rev: row.local_rev,
      inflight_rev: row.inflight_rev,
      version: row.server_version ?? (typeof row.payload.version === "number" ? row.payload.version : undefined),
    } as PendingEntry),
  }));

  const tally = { saved: 0 };
  let failed = 0;
  let deleted = 0;
  let error: string | undefined;

  try {
    if (entrySnaps.length) {
      const resp = await api.syncEntries(
        entrySnaps.map((snap) => snap.payload),
        token,
      );
      const counts = await applyEntrySnapshots(entrySnaps, resp.results ?? []);
      tally.saved += counts.saved;
      failed += counts.failed;
      deleted += counts.deleted;
      error = resp.results?.find((row) => row.status === "conflict" || row.status === "rejected")?.reason ?? undefined;
    }
    await flushLifeKindsTracked(token, lifeRows, tally);
  } catch (e) {
    if (isNetworkError(e)) {
      return { attempted: claimed.length, saved: tally.saved, failed, deleted, error: "offline" };
    }
    if (isAuthError(e)) {
      return { attempted: claimed.length, saved: tally.saved, failed, deleted, error: "auth" };
    }
    const msg = (e as Error).message ?? "sync failed";
    let marked = 0;
    for (const snap of entrySnaps) {
      const row = await getEntry(db, snap.id);
      if (!row || alreadyAcked(row.status)) continue;
      await applyEntryResult(snap, { status: "error", reason: msg });
      marked += 1;
    }
    for (const snap of lifeRows) {
      const row = await getLife(db, snap.id);
      if (!row || alreadyAcked(row.status)) continue;
      await applyLifeResult(snap, { status: "error", reason: msg });
      marked += 1;
    }
    return { attempted: claimed.length, saved: tally.saved, failed: failed + marked, deleted, error: msg };
  }

  return { attempted: claimed.length, saved: tally.saved, failed, deleted, error };
}

export async function flushOutbox(token: string, userId: string): Promise<OutboxFlushResult> {
  return withSyncLock(() => flushOutboxUnlocked(token, userId));
}
