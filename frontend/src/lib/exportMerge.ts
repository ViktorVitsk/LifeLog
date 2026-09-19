import type { EntryRead, LifeBundle } from "./api.ts";
import type { PendingEntry, PendingLife } from "../db/offlineQueue.ts";

export function mergeExportEntries(
  server: EntryRead[],
  local: PendingEntry[],
  userId: string,
): { id: string; source: "server" | "local"; sync_status: string; row: EntryRead | PendingEntry }[] {
  const byId = new Map<string, { id: string; source: "server" | "local"; sync_status: string; row: EntryRead | PendingEntry }>();
  for (const item of server) {
    byId.set(item.id, { id: item.id, source: "server", sync_status: "on_server", row: item });
  }
  for (const item of local) {
    if (item.owner_user_id !== userId) continue;
    if (item.status === "synced" && byId.has(item.id)) continue;
    byId.set(item.id, {
      id: item.id,
      source: "local",
      sync_status: item.status,
      row: item,
    });
  }
  return [...byId.values()];
}

export function mergeExportLife(server: LifeBundle | undefined, local: PendingLife[], userId: string) {
  const kinds = ["goal", "memory", "action", "feedback"] as const;
  const out: Record<(typeof kinds)[number], Record<string, unknown>[]> = {
    goal: [],
    memory: [],
    action: [],
    feedback: [],
  };
  const serverLists: Record<(typeof kinds)[number], { id: string }[]> = {
    goal: server?.goals ?? [],
    memory: server?.memory ?? [],
    action: server?.actions ?? [],
    feedback: server?.feedback ?? [],
  };
  for (const kind of kinds) {
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of serverLists[kind]) {
      byId.set(row.id, { ...row, sync_status: "on_server", source: "server" });
    }
    for (const row of local) {
      if (row.owner_user_id !== userId || row.kind !== kind) continue;
      if (row.status === "synced" && byId.has(row.id)) {
        byId.set(row.id, { ...byId.get(row.id), local_rev: row.local_rev, server_version: row.server_version });
        continue;
      }
      byId.set(row.id, {
        id: row.id,
        ...row.payload,
        sync_status: row.status,
        source: "local",
        local_rev: row.local_rev,
        server_version: row.server_version,
        last_error: row.last_error,
      });
    }
    out[kind] = [...byId.values()];
  }
  return out;
}
