import {
  applyEntryResult,
  applyEntryTombstones,
  claimPendingEntries,
  persistServerEntries,
  type EntrySendSnapshot,
} from "../db/offlineQueue";
import { api, isAuthError, isNetworkError } from "../lib/api";
import { applyLifeTombstones, persistServerLife } from "../lib/lifeQueue";
import { flushLifeQueue } from "../lib/lifeStore";
import { withSyncLock } from "../lib/syncLock.ts";

export interface SyncResult {
  attempted: number;
  saved: number;
  failed: number;
  deleted?: number;
  error?: string;
}

export async function pullRemoteDeletes(token: string): Promise<void> {
  try {
    const tombs = await api.getEntryTombstones(token);
    await applyEntryTombstones((tombs.items ?? []).map((item) => item.id));
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

async function applySnapshots(
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

async function runSyncOnceUnlocked(token: string, userId?: string): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { attempted: 0, saved: 0, failed: 0, error: "offline" };
  }

  const snapshots = await claimPendingEntries(100, userId);
  if (snapshots.length === 0) {
    await pullRemoteDeletes(token);
    return { attempted: 0, saved: 0, failed: 0 };
  }

  try {
    const resp = await api.syncEntries(
      snapshots.map((snap) => snap.payload),
      token,
    );
    const counts = await applySnapshots(snapshots, resp.results ?? []);
    await pullRemoteDeletes(token);
    return {
      attempted: snapshots.length,
      saved: counts.saved,
      failed: counts.failed,
      deleted: counts.deleted,
      error: resp.results?.find((row) => row.status === "conflict" || row.status === "rejected")?.reason ?? undefined,
    };
  } catch (e) {
    if (isNetworkError(e)) {
      return { attempted: snapshots.length, saved: 0, failed: 0, error: "offline" };
    }
    if (isAuthError(e)) {
      return { attempted: snapshots.length, saved: 0, failed: 0, error: "auth" };
    }
    const msg = (e as Error).message ?? "sync failed";
    for (const snap of snapshots) {
      await applyEntryResult(snap, { status: "error", reason: msg });
    }
    return { attempted: snapshots.length, saved: 0, failed: snapshots.length, error: msg };
  }
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
      const lifeSaved = await flushLifeQueue(token, userId).catch(() => 0);
      try {
        const tombs = await api.getLifeTombstones(token);
        await applyLifeTombstones((tombs.items ?? []).map((item) => item.id));
      } catch {
        /* keep local life rows unless an explicit tombstone arrives */
      }
      await refreshLifeCache(token, userId);
      onResult?.(lifeSaved ? { ...r, saved: r.saved + lifeSaved } : r);
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
