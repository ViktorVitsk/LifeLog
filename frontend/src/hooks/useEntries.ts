import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { getSessionToken, useAuth } from "../context/AuthContext";
import { db, persistServerEntries, type PendingEntry } from "../db/offlineQueue";
import { api, AuthError, type EntryRead } from "../lib/api";
import { mergeEntryStreams } from "../sync/mergeEntries";

/**
 * Unified entry stream: server (synced) + local Dexie (pending/error).
 *
 * We deliberately merge by `id` — the client-generated UUID is the primary key
 * on both sides, so once sync succeeds the two sources agree. Until then, the
 * dashboard shows optimistic pending rows.
 *
 * IMPORTANT: we only read OPEN fields here (timestamp, entry_type,
 * mood_score, energy_score, anxiety_score, ...). Plaintext content is
 * NEVER decrypted in this hook — that's the architecture's whole point.
 */

export type MergedEntry = EntryRead & { _source: "server" | "pending" | "error" | "rejected" | "conflict" };

function normalizeLocal(p: PendingEntry): MergedEntry {
  const source: MergedEntry["_source"] =
    p.status === "rejected"
      ? "rejected"
      : p.status === "conflict"
        ? "conflict"
      : p.status === "error"
        ? "error"
        : p.status === "synced"
          ? "server"
          : "pending";
  return {
    ...p,
    created_at: p.created_at || "",
    synced_from_offline: false,
    _source: source,
  };
}

export function useEntries() {
  const { token, userId } = useAuth();

  const serverQuery = useQuery<EntryRead[]>({
    queryKey: ["entries", userId],
    enabled: Boolean(token && userId),
    queryFn: async () => {
      const t = getSessionToken();
      if (!t) throw new AuthError("session expired");
      const items = await api.listEntries(t, { limit: 1000 });
      if (userId) await persistServerEntries(items, userId);
      return items;
    },
  });

  const local = useLiveQuery(() => db.entries.toArray(), [], [] as PendingEntry[]);

  const merged = useMemo<MergedEntry[]>(() => {
    const plan = mergeEntryStreams(local ?? [], serverQuery.data ?? [], userId);
    const rows: MergedEntry[] = [];
    for (const item of plan) {
      if (item.source !== "server" && item.local) {
        rows.push(normalizeLocal(item.local));
        continue;
      }
      if (item.server) {
        rows.push({ ...item.server, _source: "server" });
        continue;
      }
      if (item.local) rows.push({ ...normalizeLocal(item.local), _source: "server" });
    }
    return rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }, [serverQuery.data, local, userId]);

  const pendingCount = useMemo(
    () =>
      (local ?? []).filter(
        (r) =>
          (r.status === "pending" ||
            r.status === "error" ||
            r.status === "rejected" ||
            r.status === "conflict" ||
            r.status === "pending_delete") &&
          userId &&
          r.owner_user_id === userId,
      ).length,
    [local, userId],
  );

  return {
    entries: merged,
    isLoading: serverQuery.isLoading,
    error: serverQuery.error as Error | null,
    refetch: serverQuery.refetch,
    pendingCount,
  };
}
