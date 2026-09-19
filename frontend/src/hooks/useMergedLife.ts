import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { db, type PendingLife } from "../db/offlineQueue";
import { listOwnedLife } from "../db/outbox";
import { api, type LifeBundle } from "../lib/api";
import { persistServerLife } from "../lib/lifeQueue";
import { mergeLifeBundle, nextDueAt } from "../lib/mergeLife";

export function useMergedLife() {
  const { token, userId } = useAuth();
  const server = useQuery<LifeBundle>({
    queryKey: ["life", userId],
    enabled: Boolean(token && userId),
    queryFn: async () => {
      const bundle = await api.getLife(token!);
      if (userId) await persistServerLife(bundle, userId);
      return bundle;
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const local = useLiveQuery(
    () => (userId ? listOwnedLife(db, userId) : []),
    [userId],
    [] as PendingLife[],
  );
  const bundle = useMemo(
    () => mergeLifeBundle(server.data, local ?? [], userId),
    [server.data, local, userId],
  );
  const statuses = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of local ?? []) map.set(row.id, row.status);
    return map;
  }, [local]);
  const dueAt = useMemo(() => nextDueAt(bundle.actions), [bundle.actions]);
  return { bundle, statuses, local: local ?? [], server, dueAt };
}
