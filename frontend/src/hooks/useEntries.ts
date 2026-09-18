import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { getSessionToken, useAuth } from "../context/AuthContext";
import { db, type PendingEntry } from "../db/offlineQueue";
import { api, AuthError, type EntryRead } from "../lib/api";

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

export type MergedEntry = EntryRead & { _source: "server" | "pending" | "error" };

function normalizeLocal(p: PendingEntry): MergedEntry {
  const source: MergedEntry["_source"] =
    p.status === "error" ? "error" : p.status === "synced" ? "server" : "pending";
  return {
    ...p,
    created_at: new Date(p.queued_at).toISOString(),
    synced_from_offline: false,
    _source: source,
  };
}

export function useEntries() {
  const { token, userId } = useAuth();

  const serverQuery = useQuery<EntryRead[]>({
    queryKey: ["entries", userId],
    enabled: Boolean(token && userId),
    queryFn: () => {
      const t = getSessionToken();
      if (!t) throw new AuthError("session expired");
      return api.listEntries(t, { limit: 1000 });
    },
  });

  const local = useLiveQuery(() => db.entries.toArray(), [], [] as PendingEntry[]);

  const merged = useMemo<MergedEntry[]>(() => {
    const byId = new Map<string, MergedEntry>();

    for (const row of local ?? []) {
      if (!userId || row.owner_user_id !== userId) continue;
      byId.set(row.id, normalizeLocal(row));
    }
    for (const row of serverQuery.data ?? []) {
      byId.set(row.id, { ...row, _source: "server" });
    }
    return [...byId.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }, [serverQuery.data, local, userId]);

  const pendingCount = useMemo(
    () =>
      (local ?? []).filter(
        (r) =>
          (r.status === "pending" || r.status === "error") && userId && r.owner_user_id === userId,
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
