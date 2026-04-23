import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { SyncProvider, useSync } from "../context/SyncContext";
import { useEntries } from "../hooks/useEntries";

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export default function Layout() {
  return (
    <SyncProvider>
      <LayoutInner />
    </SyncProvider>
  );
}

function LayoutInner() {
  const { username, logout } = useAuth();
  const sync = useSync();
  const { pendingCount } = useEntries();
  const online = useOnlineStatus();

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    [
      "px-3 py-1.5 rounded text-sm transition-colors",
      isActive ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-zinc-800",
    ].join(" ");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
          <div className="font-semibold tracking-tight">LifeLog</div>
          <nav className="flex gap-1">
            <NavLink to="/checkin" className={linkCls}>
              Check-in
            </NavLink>
            <NavLink to="/dashboard" className={linkCls}>
              Dashboard
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            <SyncBadge pending={pendingCount} result={sync.lastResult} online={online} />
            <span>{username}</span>
            <button
              onClick={logout}
              className="px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function SyncBadge({
  pending,
  result,
  online,
}: {
  pending: number;
  result: ReturnType<typeof useSync>["lastResult"];
  online: boolean;
}) {
  if (!online) {
    return (
      <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
        offline{pending > 0 ? ` · ${pending} queued` : ""}
      </span>
    );
  }
  if (pending > 0) {
    return (
      <span className="px-2 py-0.5 rounded bg-amber-900/40 border border-amber-700 text-amber-200">
        {pending} pending
      </span>
    );
  }
  // Non-network sync errors (4xx/5xx) are worth surfacing. "offline" from
  // the manager is silent — the offline badge already covers that case.
  if (result?.error && result.error !== "offline") {
    return (
      <span className="px-2 py-0.5 rounded bg-rose-900/40 border border-rose-700 text-rose-200">
        sync: {result.error}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-200">
      synced
    </span>
  );
}
