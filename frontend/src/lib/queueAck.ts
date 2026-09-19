import type { QueueStatus } from "../db/offlineQueue.ts";

export type QueueAckKind = "success" | "conflict" | "rejected" | "error" | "deleted";

export interface RevisionRow {
  local_rev?: number;
  inflight_rev?: number;
  server_version?: number;
  status: QueueStatus;
  last_error?: string;
  conflict_version?: number;
  owner_user_id?: string;
}

export interface QueueAck {
  kind: QueueAckKind;
  version?: number | null;
  reason?: string | null;
}

export function ackKindFromStatus(status: string): QueueAckKind {
  if (status === "created" || status === "duplicate" || status === "updated") return "success";
  if (status === "deleted") return "deleted";
  if (status === "conflict") return "conflict";
  if (status === "rejected") return "rejected";
  if (status === "error") return "error";
  return "error";
}

/**
 * Apply a server result to the row that exists *now*.
 * A newer local_rev keeps its payload; only a matching success/delete
 * of the previous snapshot may advance server_version.
 * A stale conflict/reject/error must not rewrite the newer edit.
 */
export function applyRevisionAck<T extends RevisionRow>(
  row: T,
  sent: { owner: string; local_rev: number },
  ack: QueueAck,
): { row: T; drop: boolean; ignored: boolean } {
  if (row.owner_user_id && row.owner_user_id !== sent.owner) {
    return { row, drop: false, ignored: true };
  }
  const currentRev = row.local_rev ?? 1;
  const next: T = { ...row, inflight_rev: undefined };

  if (currentRev !== sent.local_rev) {
    if (ack.kind === "success" || ack.kind === "deleted") {
      if (ack.version != null) next.server_version = ack.version;
      if (next.status === "synced") next.status = "pending";
    } else if (ack.kind === "conflict" && ack.version != null) {
      next.conflict_version = ack.version;
    }
    return { row: next, drop: false, ignored: false };
  }

  if (ack.kind === "success") {
    next.status = "synced";
    next.last_error = undefined;
    if (ack.version != null) next.server_version = ack.version;
    return { row: next, drop: false, ignored: false };
  }
  if (ack.kind === "deleted") {
    return { row: next, drop: true, ignored: false };
  }
  if (ack.kind === "conflict") {
    next.status = "conflict";
    next.last_error = ack.reason ?? "conflict";
    if (ack.version != null) next.conflict_version = ack.version;
    return { row: next, drop: false, ignored: false };
  }
  if (ack.kind === "rejected") {
    next.status = "rejected";
    next.last_error = ack.reason ?? "rejected";
    return { row: next, drop: false, ignored: false };
  }
  next.status = "error";
  next.last_error = (ack.reason ?? "error").slice(0, 200);
  return { row: next, drop: false, ignored: false };
}
