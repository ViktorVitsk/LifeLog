import { applyEntryTombstones, persistServerEntries } from "../db/offlineQueue";
import { api } from "../lib/api";
import { applyLifeTombstones, persistServerLife } from "../lib/lifeQueue";
import { resumeFeedbackOps } from "../lib/lifeOp";
import { flushOutboxUnlocked } from "../lib/flushOutbox";
import { withSyncLock } from "../lib/syncLock.ts";
import { getCurrentUserId } from "../lib/accountScope.ts";

export interface SyncResult {
  attempted: number;
  saved: number;
  failed: number;
  deleted?: number;
  error?: string;
}

export async function pullRemoteDeletes(token: string, owner: string): Promise<void> {
  try {
    const tombs = await api.getEntryTombstones(token);
    await applyEntryTombstones(tombs.items ?? [], owner);
  } catch {
    /* keep local rows unless an explicit tombstone arrives */
  }
}

export async function refreshLifeCache(token: string, userId: string): Promise<void> {
  try {
    const bundle = await api.getLife(token);
    await persistServerLife(bundle, userId);
  } catch {
    /* last known cache stays */
  }
}

export async function runSyncOnce(token: string, userId?: string): Promise<SyncResult> {
  return withSyncLock(() => runSyncOnceUnlocked(token, userId));
}

async function runSyncOnceUnlocked(token: string, userId?: string): Promise<SyncResult> {
  const owner = userId ?? getCurrentUserId();
  if (!owner) return { attempted: 0, saved: 0, failed: 0 };
  const result = await flushOutboxUnlocked(token, owner);
  if (owner) await pullRemoteDeletes(token, owner);
  return result;
}

export interface SyncManagerHandle {
  stop: () => void;
  trigger: () => void;
}

export interface StartSyncOptions {
  getToken: () => string | null;
  getUserId?: () => string | null;
  intervalMs?: number;
  onResult?: (r: SyncResult) => void;
}

export function startSyncManager(opts: StartSyncOptions): SyncManagerHandle {
  const { getToken, getUserId, intervalMs = 30_000, onResult } = opts;

  let stopped = false;
  let inFlight: Promise<void> | null = null;

  async function tick() {
    if (stopped || inFlight) return;
    const token = getToken();
    const userId = getUserId?.() ?? null;
    if (!token || !userId) return;
    inFlight = (async () => {
      const r = await runSyncOnce(token, userId);
      await resumeFeedbackOps(userId);
      try {
        const tombs = await api.getLifeTombstones(token);
        await applyLifeTombstones(tombs.items ?? [], userId);
      } catch {
        /* keep local life rows unless an explicit tombstone arrives */
      }
      await refreshLifeCache(token, userId);
      onResult?.(r);
    })().finally(() => {
      inFlight = null;
    });
    await inFlight;
  }

  const timer = window.setInterval(tick, intervalMs);
  const onOnline = () => tick();
  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  void tick();

  return {
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    },
    trigger: () => {
      void tick();
    },
  };
}

export { persistServerEntries };
