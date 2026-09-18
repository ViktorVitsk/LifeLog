import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { startSyncManager, type SyncResult } from "../sync/syncManager";

/**
 * Single global SyncManager bound to the authenticated session.
 *
 * Mounted once (inside Layout, under AuthProvider). All pages call
 * `useSync()` to read the last result and trigger manual pushes.
 * This avoids spawning multiple managers from multiple hooks.
 */

interface SyncContextValue {
  lastResult: SyncResult | null;
  trigger: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { token, userId } = useAuth();
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const triggerRef = useRef<(() => void) | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const authed = Boolean(token && userId);

  useEffect(() => {
    if (!authed) return;

    const handle = startSyncManager({
      getToken: () => tokenRef.current,
      getUserId: () => userIdRef.current,
      onResult: (r) => {
        if (r.attempted > 0 || r.error) setLastResult(r);
        if (r.saved > 0 || (r.deleted ?? 0) > 0) {
          const uid = userIdRef.current;
          void qc.invalidateQueries({ queryKey: uid ? ["entries", uid] : ["entries"] });
        }
      },
    });
    triggerRef.current = handle.trigger;

    return () => {
      triggerRef.current = null;
      handle.stop();
    };
  }, [authed, userId, qc]);

  return (
    <SyncContext.Provider
      value={{
        lastResult,
        trigger: () => triggerRef.current?.(),
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within <SyncProvider>");
  return ctx;
}
