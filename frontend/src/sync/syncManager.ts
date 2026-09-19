import {
  ackDeletes,
  applyEntryTombstones,
  getEntryStatuses,
  getPendingForSync,
  markError,
  markInflight,
  markRejected,
  markSynced,
} from "../db/offlineQueue";
import { api, isAuthError, isNetworkError, type EntrySyncPayload } from "../lib/api";
import { applyLifeTombstones } from "../lib/lifeQueue";
import { flushLifeQueue } from "../lib/lifeStore";
import { withSyncLock } from "../lib/syncLock.ts";
import { planQueueUpdates } from "./syncContract.ts";

/**
 * Pushes pending entries in one POST. Queue status follows per-item results.
 */
export interface SyncResult {
  attempted: number;
  saved: number;
  failed: number;
  deleted?: number;
  error?: string;
}

export async function runSyncOnce(token: string, userId?: string): Promise<SyncResult> {
  return withSyncLock(() => runSyncOnceUnlocked(token, userId));
}

async function runSyncOnceUnlocked(token: string, userId?: string): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { attempted: 0, saved: 0, failed: 0, error: "offline" };
  }

  const pending = await getPendingForSync(100, userId);
  if (pending.length === 0) return { attempted: 0, saved: 0, failed: 0 };

  const ids = pending.map((p) => p.id);

  const payload: EntrySyncPayload[] = pending.map((p) => ({
    id: p.id,
    timestamp: p.timestamp,
    entry_type: p.entry_type,
    skill_id: p.skill_id,
    habit_id: p.habit_id,
    context_id: p.context_id,
    tags: p.tags,
    mood_score: p.mood_score,
    energy_score: p.energy_score,
    anxiety_score: p.anxiety_score,
    focus_score: p.focus_score,
    social_battery_score: p.social_battery_score,
    stress_score: p.stress_score,
    sleep_hours: p.sleep_hours,
    sleep_quality: p.sleep_quality,
    weight_kg: p.weight_kg,
    body_fat_pct: p.body_fat_pct,
    session_duration_min: p.session_duration_min,
    habit_completed: p.habit_completed,
    habit_value: p.habit_value,
    resentment_score: p.resentment_score,
    guilt_score: p.guilt_score,
    shame_score: p.shame_score,
    fear_score: p.fear_score,
    encrypted_dek: p.encrypted_dek,
    encrypted_content: p.encrypted_content,
    version: p.version ?? 1,
    deleted: p.status === "pending_delete" || p.deleted === true,
    recorded_at: p.recorded_at,
    event_timezone: p.event_timezone,
  }));

  try {
    const sentRevs = await markInflight(ids);
    const resp = await api.syncEntries(payload, token);
    const after = await getEntryStatuses(ids);
    const deletingIds = pending.filter((p) => p.status === "pending_delete" || p.deleted).map((p) => p.id);
    const hideCreatedIfTombstone = ids.filter((id) => after[id] === "pending_delete");
    const plan = planQueueUpdates(resp, ids, { deletingIds, hideCreatedIfTombstone });
    const versions: Record<string, number> = {};
    for (const row of resp.results ?? []) {
      if (typeof row.version === "number") versions[row.id] = row.version;
    }
    await markSynced(plan.markSynced, { sentRevs, versions });
    await markRejected(plan.markRejected);
    await ackDeletes(plan.ackDelete);
    try {
      const tombs = await api.getEntryTombstones(token);
      await applyEntryTombstones((tombs.items ?? []).map((item) => item.id));
    } catch {
      /* tombstone pull is best-effort; local pending rows stay */
    }
    return {
      attempted: pending.length,
      saved: plan.markSynced.length,
      failed: plan.markRejected.length,
      deleted: plan.ackDelete.length,
      error: plan.markRejected[0]?.reason,
    };
  } catch (e) {
    if (isNetworkError(e)) {
      return {
        attempted: pending.length,
        saved: 0,
        failed: 0,
        error: "offline",
      };
    }
    if (isAuthError(e)) {
      return {
        attempted: pending.length,
        saved: 0,
        failed: 0,
        error: "auth",
      };
    }
    const msg = (e as Error).message ?? "sync failed";
    await markError(ids, msg);
    return { attempted: pending.length, saved: 0, failed: pending.length, error: msg };
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
