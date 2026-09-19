import { api, type LifeBundle, type LifeSyncResponse } from "./api.ts";
import type { PendingLife } from "../db/offlineQueue.ts";
import { planQueueUpdates } from "../sync/syncContract.ts";
import { withSyncLock } from "./syncLock.ts";
import { assembleMemoryProfile } from "./lifeProfile.ts";
import {
  applyLifeAck,
  encryptLifePayload,
  enqueueLife,
  getPendingLife,
  listOwnedLife,
  nextLifeEnqueue,
  lifeSyncPayload,
  readLifeRow,
  writeLife,
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

async function applyLifePlan(
  resp: LifeSyncResponse,
  sent: { id: string; rev: number }[],
): Promise<void> {
  const byId = new Map(sent.map((item) => [item.id, item.rev]));
  const plan = planQueueUpdates(resp, sent.map((item) => item.id));
  for (const id of new Set([...plan.markSynced, ...plan.markRejected.map((r) => r.id), ...plan.ackDelete])) {
    const row = await readLifeRow(id);
    if (!row) continue;
    const result = resp.results.find((item) => item.id === id) ?? {
      id,
      status: plan.ackDelete.includes(id) ? "deleted" : "updated",
    };
    await writeLife(applyLifeAck(row, byId.get(id) ?? row.local_rev ?? 1, result));
  }
}

async function flushKind(
  rows: PendingLife[],
  send: (items: Record<string, unknown>[]) => Promise<LifeSyncResponse>,
): Promise<number> {
  if (!rows.length) return 0;
  const sent = rows.map((row) => {
    const rev = row.local_rev ?? 1;
    row.inflight_rev = rev;
    return { id: row.id, rev };
  });
  for (const row of rows) await writeLife(row);
  const resp = await send(rows.map((row) => lifeSyncPayload(row)));
  await applyLifePlan(resp, sent);
  return resp.saved.length;
}

export async function flushLifeQueue(token: string, userId: string): Promise<number> {
  return withSyncLock(async () => {
    const pending = await getPendingLife(userId);
    if (!pending.length) return 0;
    const byKind = {
      goal: pending.filter((row) => row.kind === "goal"),
      memory: pending.filter((row) => row.kind === "memory"),
      action: pending.filter((row) => row.kind === "action"),
      feedback: pending.filter((row) => row.kind === "feedback"),
    };
    let saved = 0;
    if (byKind.goal.length) {
      saved += await flushKind(byKind.goal, (items) => api.syncLifeGoals(token, items as never));
    }
    if (byKind.memory.length) {
      saved += await flushKind(byKind.memory, (items) => api.syncLifeMemory(token, items as never));
    }
    if (byKind.action.length) {
      saved += await flushKind(byKind.action, (items) => api.syncLifeActions(token, items as never));
    }
    if (byKind.feedback.length) {
      saved += await flushKind(byKind.feedback, (items) => api.syncLifeFeedback(token, items as never));
    }
    return saved;
  });
}

export type { LifeBundle };
