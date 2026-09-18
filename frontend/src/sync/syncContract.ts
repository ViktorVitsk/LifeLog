export type SyncItemStatus = "created" | "duplicate" | "conflict" | "rejected" | "deleted";

export interface SyncItemResult {
  id: string;
  status: string;
  reason?: string | null;
}

export interface SyncApiResponse {
  results?: SyncItemResult[];
  saved?: string[];
}

export interface QueueUpdatePlan {
  markSynced: string[];
  markRejected: { id: string; reason: string }[];
  ackDelete: string[];
  leavePending: string[];
}

export interface PlanQueueOpts {
  /** Ids we sent as deleted:true */
  deletingIds?: string[];
  /** Ids that became tombstones while the request was in flight */
  hideCreatedIfTombstone?: string[];
}

/**
 * Client may mark an id synced only when the server confirmed it is stored
 * (created) or already identical (duplicate). A create that lands after local
 * undo stays pending_delete. Successful deletes are acked, not synced.
 */
export function planQueueUpdates(
  response: SyncApiResponse,
  sentIds: string[],
  opts: PlanQueueOpts = {},
): QueueUpdatePlan {
  const sent = new Set(sentIds);
  const deleting = new Set(opts.deletingIds ?? []);
  const tombstones = new Set(opts.hideCreatedIfTombstone ?? []);
  const markSynced: string[] = [];
  const markRejected: { id: string; reason: string }[] = [];
  const ackDelete: string[] = [];
  const seen = new Set<string>();

  const act = (id: string, status: string, reason?: string | null) => {
    if (!sent.has(id) || seen.has(id)) return;
    seen.add(id);
    if (deleting.has(id)) {
      if (status === "deleted" || status === "duplicate") {
        ackDelete.push(id);
        return;
      }
      if (status === "conflict" || status === "rejected") {
        markRejected.push({ id, reason: reason ?? status });
      }
      return;
    }
    if (tombstones.has(id) && (status === "created" || status === "duplicate")) {
      return;
    }
    if (status === "created" || status === "duplicate" || status === "updated") {
      markSynced.push(id);
      return;
    }
    if (status === "conflict" || status === "rejected") {
      markRejected.push({ id, reason: reason ?? status });
    }
  };

  if (response.results && response.results.length > 0) {
    for (const row of response.results) {
      act(row.id, row.status, row.reason);
    }
  } else {
    for (const id of response.saved ?? []) {
      act(id, "created");
    }
  }

  const acted = new Set([...markSynced, ...ackDelete, ...markRejected.map((row) => row.id)]);
  const leavePending = sentIds.filter((id) => !acted.has(id));
  return { markSynced, markRejected, ackDelete, leavePending };
}
