export type LocalQueueStatus = "pending" | "synced" | "error" | "rejected" | "pending_delete";

export interface LocalEntryRow {
  id: string;
  owner_user_id?: string;
  status: LocalQueueStatus;
}

export interface Mergeable {
  id: string;
}

export type MergedSource = "server" | "pending" | "error" | "rejected";

function sourceOf(status: LocalQueueStatus): MergedSource {
  if (status === "synced" || status === "pending_delete") return "server";
  return status;
}

/**
 * Unsynced local rows win over the server copy so a conflict/reject
 * is not hidden by GET /api/entries.
 */
export function mergeEntryStreams<L extends LocalEntryRow, S extends Mergeable>(
  local: L[],
  server: S[],
  userId: string | null,
): { id: string; source: MergedSource; local?: L; server?: S }[] {
  const localById = new Map<string, L>();
  for (const row of local) {
    if (!userId || row.owner_user_id !== userId) continue;
    if (row.status === "pending_delete") continue;
    localById.set(row.id, row);
  }
  const hidden = new Set(
    local.filter((row) => row.owner_user_id === userId && row.status === "pending_delete").map((row) => row.id),
  );

  const byId = new Map<string, { id: string; source: MergedSource; local?: L; server?: S }>();
  for (const row of server) {
    if (hidden.has(row.id)) continue;
    const loc = localById.get(row.id);
    if (loc && loc.status !== "synced") {
      byId.set(row.id, { id: row.id, source: sourceOf(loc.status), local: loc, server: row });
    } else {
      byId.set(row.id, { id: row.id, source: "server", local: loc, server: row });
    }
  }
  for (const loc of localById.values()) {
    if (byId.has(loc.id)) continue;
    byId.set(loc.id, {
      id: loc.id,
      source: sourceOf(loc.status),
      local: loc,
    });
  }
  return [...byId.values()];
}
