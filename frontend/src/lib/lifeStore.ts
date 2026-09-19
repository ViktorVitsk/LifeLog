import { api, type LifeBundle, type LifeSyncResponse } from "./api.ts";
import type { LifeKind, PendingLife } from "../db/offlineQueue.ts";
import { planQueueUpdates } from "../sync/syncContract.ts";
import { withSyncLock } from "./syncLock.ts";
import { assembleMemoryProfile } from "./lifeProfile.ts";
import {
  applyLifeAck,
  applyLifeResult,
  claimLifeForSend,
  encryptLifePayload,
  enqueueLife,
  getPendingLife,
  listOwnedLife,
  nextLifeEnqueue,
  lifeSyncPayload,
  type LifeSendSnapshot,
} from "./lifeQueue.ts";

export {
  assembleMemoryProfile,
  applyLifeAck,
  encryptLifePayload,
  enqueueLife,
  getPendingLife,
  listOwnedLife,
  nextLifeEnqueue,
};

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
  snapshots: { id: string; owner: string; kind: LifeKind; local_rev: number; payload: Record<string, unknown>; server_version?: number; status: PendingLife["status"] }[],
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

export async function flushLifeQueue(token: string, userId: string): Promise<number> {
  return withSyncLock(async () => {
    const snapshots = await claimLifeForSend(userId);
    if (!snapshots.length) return 0;
    let saved = 0;
    saved += await flushKind("goal", snapshots, (items) => api.syncLifeGoals(token, items as never));
    saved += await flushKind("memory", snapshots, (items) => api.syncLifeMemory(token, items as never));
    saved += await flushKind("action", snapshots, (items) => api.syncLifeActions(token, items as never));
    saved += await flushKind("feedback", snapshots, (items) => api.syncLifeFeedback(token, items as never));
    return saved;
  });
}

export type { LifeBundle };
