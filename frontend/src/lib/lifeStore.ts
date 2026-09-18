import { assertEncryptAllowed, requireCurrentUserId } from "./accountScope.ts";
import { api, type LifeBundle, type LifeSyncResponse } from "./api.ts";
import { encryptEntry } from "./crypto.ts";
import { db, type LifeKind, type PendingLife } from "../db/offlineQueue.ts";
import { planQueueUpdates } from "../sync/syncContract.ts";
import { assembleMemoryProfile } from "./lifeProfile.ts";

export { assembleMemoryProfile };

export async function enqueueLife(kind: LifeKind, payload: Record<string, unknown>): Promise<void> {
  assertEncryptAllowed();
  const owner = requireCurrentUserId();
  const id = String(payload.id);
  await db.life_queue.put({
    id,
    kind,
    payload,
    status: "pending",
    owner_user_id: owner,
    queued_at: Date.now(),
  });
}

export async function getPendingLife(userId: string): Promise<PendingLife[]> {
  const rows = await db.life_queue.where("status").anyOf(["pending", "error"]).toArray();
  return rows.filter((row) => row.owner_user_id === userId);
}

async function applyLifePlan(resp: LifeSyncResponse, ids: string[]): Promise<void> {
  const plan = planQueueUpdates(resp, ids);
  if (plan.markSynced.length) {
    await db.life_queue.where("id").anyOf(plan.markSynced).modify((row) => {
      row.status = "synced";
    });
  }
  for (const item of plan.markRejected) {
    await db.life_queue.update(item.id, { status: "rejected", last_error: item.reason });
  }
}

export async function flushLifeQueue(token: string, userId: string): Promise<number> {
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
    const resp = await api.syncLifeGoals(token, byKind.goal.map((row) => row.payload as never));
    await applyLifePlan(resp, byKind.goal.map((row) => row.id));
    saved += resp.saved.length;
  }
  if (byKind.memory.length) {
    const resp = await api.syncLifeMemory(token, byKind.memory.map((row) => row.payload as never));
    await applyLifePlan(resp, byKind.memory.map((row) => row.id));
    saved += resp.saved.length;
  }
  if (byKind.action.length) {
    const resp = await api.syncLifeActions(token, byKind.action.map((row) => row.payload as never));
    await applyLifePlan(resp, byKind.action.map((row) => row.id));
    saved += resp.saved.length;
  }
  if (byKind.feedback.length) {
    const resp = await api.syncLifeFeedback(token, byKind.feedback.map((row) => row.payload as never));
    await applyLifePlan(resp, byKind.feedback.map((row) => row.id));
    saved += resp.saved.length;
  }
  return saved;
}

export async function encryptLifePayload(
  kek: CryptoKey,
  body: Record<string, unknown>,
): Promise<{ encrypted_dek: string; encrypted_content: string }> {
  const { encryptedContent, encryptedDek } = await encryptEntry(JSON.stringify(body), kek);
  return { encrypted_content: encryptedContent, encrypted_dek: encryptedDek };
}

export type { LifeBundle };
