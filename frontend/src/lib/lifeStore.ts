import { type LifeBundle } from "./api.ts";
import { withSyncLock } from "./syncLock.ts";
import { assembleMemoryProfile } from "./lifeProfile.ts";
import { flushLifeKinds } from "./flushOutbox.ts";
import {
  applyLifeAck,
  claimLifeForSend,
  encryptLifePayload,
  enqueueLife,
  getPendingLife,
  listOwnedLife,
  nextLifeEnqueue,
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

export async function flushLifeQueue(token: string, userId: string): Promise<number> {
  return withSyncLock(async () => {
    const snapshots = await claimLifeForSend(userId);
    return flushLifeKinds(token, snapshots);
  });
}

export type { LifeBundle };
