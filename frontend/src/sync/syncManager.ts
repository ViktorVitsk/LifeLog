import { getPendingForSync, markError, markSynced } from "../db/offlineQueue";
import { api, isNetworkError, type EntrySyncPayload } from "../lib/api";

/**
 * Tries to push every pending entry to the server in a single batched POST.
 * Idempotent on the server side (ON CONFLICT DO NOTHING on id), so retries are safe.
 *
 * Returns a summary so the UI can surface progress.
 */
export interface SyncResult {
  attempted: number;
  saved: number;
  failed: number;
  error?: string;
}

export async function runSyncOnce(token: string): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { attempted: 0, saved: 0, failed: 0, error: "offline" };
  }

  const pending = await getPendingForSync(100);
  if (pending.length === 0) return { attempted: 0, saved: 0, failed: 0 };

  const ids = pending.map((p) => p.id);

  // Strip queue-only bookkeeping fields before sending to the server.
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
    sleep_hours: p.sleep_hours,
    sleep_quality: p.sleep_quality,
    session_duration_min: p.session_duration_min,
    habit_completed: p.habit_completed,
    habit_value: p.habit_value,
    resentment_score: p.resentment_score,
    guilt_score: p.guilt_score,
    shame_score: p.shame_score,
    fear_score: p.fear_score,
    encrypted_dek: p.encrypted_dek,
    encrypted_content: p.encrypted_content,
  }));

  try {
    const resp = await api.syncEntries(payload, token);
    const savedIds = resp.saved ?? [];
    // Mark EVERY id we sent as synced — server uses ON CONFLICT DO NOTHING,
    // so an id already present on the server is still "safely stored".
    await markSynced(ids);
    return { attempted: pending.length, saved: savedIds.length, failed: 0 };
  } catch (e) {
    // Network failures (offline, DNS, server down) are transient — keep rows
    // as "pending" and silently wait for the next tick. Only genuine server
    // rejections (4xx/5xx with a message) should be recorded as "error".
    if (isNetworkError(e)) {
      return {
        attempted: pending.length,
        saved: 0,
        failed: 0,
        error: "offline",
      };
    }
    const msg = (e as Error).message ?? "sync failed";
    await markError(ids, msg);
    return { attempted: pending.length, saved: 0, failed: pending.length, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle: start / stop
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncManagerHandle {
  stop: () => void;
  /** Ask for an immediate sync pass (non-blocking). */
  trigger: () => void;
}

export interface StartSyncOptions {
  getToken: () => string | null;
  intervalMs?: number;
  onResult?: (r: SyncResult) => void;
}

export function startSyncManager(opts: StartSyncOptions): SyncManagerHandle {
  const { getToken, intervalMs = 30_000, onResult } = opts;

  let stopped = false;
  let inFlight: Promise<void> | null = null;

  async function tick() {
    if (stopped || inFlight) return;
    const token = getToken();
    if (!token) return;
    inFlight = (async () => {
      const r = await runSyncOnce(token);
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
