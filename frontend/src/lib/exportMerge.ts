import type { EntryRead, LifeBundle } from "./api.ts";
import type { PendingEntry, PendingLife } from "../db/offlineQueue.ts";

export function mergeExportEntries(
  server: EntryRead[],
  local: PendingEntry[],
  userId: string,
  tombstoneIds: Iterable<string> = [],
): {
  id: string;
  source: "server" | "local";
  sync_status: string;
  row: EntryRead | PendingEntry;
  server_variant?: unknown;
}[] {
  const dead = new Set(tombstoneIds);
  const byId = new Map<
    string,
    {
      id: string;
      source: "server" | "local";
      sync_status: string;
      row: EntryRead | PendingEntry;
      server_variant?: unknown;
    }
  >();
  for (const item of server) {
    if (dead.has(item.id)) continue;
    byId.set(item.id, { id: item.id, source: "server", sync_status: "on_server", row: item });
  }
  for (const item of local) {
    if (item.owner_user_id !== userId) continue;
    if (item.status === "pending_delete" || dead.has(item.id)) {
      byId.delete(item.id);
      continue;
    }
    if (item.status === "synced" && byId.has(item.id)) continue;
    const existing = byId.get(item.id);
    byId.set(item.id, {
      id: item.id,
      source: "local",
      sync_status: item.status,
      row: item,
      server_variant: item.status === "conflict" ? existing?.row ?? null : undefined,
    });
  }
  return [...byId.values()];
}

export function mergeExportLife(
  server: LifeBundle | undefined,
  local: PendingLife[],
  userId: string,
  tombstoneIds: Iterable<string> = [],
) {
  const kinds = ["goal", "memory", "action", "feedback"] as const;
  const out: Record<(typeof kinds)[number], Record<string, unknown>[]> = {
    goal: [],
    memory: [],
    action: [],
    feedback: [],
  };
  const dead = new Set(tombstoneIds);
  const serverLists: Record<(typeof kinds)[number], { id: string }[]> = {
    goal: server?.goals ?? [],
    memory: server?.memory ?? [],
    action: server?.actions ?? [],
    feedback: server?.feedback ?? [],
  };
  for (const kind of kinds) {
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of serverLists[kind]) {
      if (dead.has(row.id)) continue;
      byId.set(row.id, { ...row, sync_status: "on_server", source: "server" });
    }
    for (const row of local) {
      if (row.owner_user_id !== userId || row.kind !== kind) continue;
      if (row.status === "pending_delete" || dead.has(row.id)) {
        if (row.status === "pending_delete" || (dead.has(row.id) && row.status === "synced")) {
          byId.delete(row.id);
        }
        continue;
      }
      if (row.status === "synced" && byId.has(row.id)) {
        byId.set(row.id, { ...byId.get(row.id), local_rev: row.local_rev, server_version: row.server_version });
        continue;
      }
      const existing = byId.get(row.id);
      byId.set(row.id, {
        id: row.id,
        ...row.payload,
        sync_status: row.status,
        source: "local",
        local_rev: row.local_rev,
        server_version: row.server_version,
        last_error: row.last_error,
        server_variant: row.status === "conflict" ? row.server_snapshot ?? existing ?? null : undefined,
        conflict_note: row.status === "conflict" ? "local_and_server_kept" : undefined,
      });
    }
    out[kind] = [...byId.values()];
  }
  return out;
}
