import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { SyncProvider, useSync } from "../context/SyncContext";
import { useEntries } from "../hooks/useEntries";
import { useIsMdUp } from "../hooks/useIsMdUp";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { useEffect, useState } from "react";

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
  const { t } = useLocale();
  const sync = useSync();
  const { pendingCount } = useEntries();
  const online = useOnlineStatus();
  const loc = useLocation();
  const md = useIsMdUp();
  const kb = useKeyboardInset();
  const showTabs = !md && kb < 80;
  const isToday = loc.pathname === "/" || loc.pathname === "/today";

  const tabs = [
    { to: "/", label: t.tabToday, end: true },
    { to: "/timeline", label: t.tabTimeline },
    { to: "/insights", label: t.tabInsights },
    { to: "/settings", label: t.tabSettings },
  ];

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    [
      "px-3 min-h-[44px] inline-flex items-center rounded text-sm transition-colors",
      isActive ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-zinc-800",
    ].join(" ");

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-3">
          <div className="font-semibold tracking-tight">LifeLog</div>
          <nav className="hidden md:flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={Boolean(tab.end)} className={linkCls}>
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
            <SyncBadge pending={pendingCount} result={sync.lastResult} online={online} />
            <span className="hidden sm:inline">{username}</span>
            <button
              onClick={logout}
              className="hidden md:inline-flex min-h-[36px] px-2 items-center rounded border border-zinc-700 hover:bg-zinc-800"
            >
              {t.logout}
            </button>
          </div>
        </div>
      </header>
      <main
        className={
          isToday
            ? "flex-1 min-h-0 overflow-hidden w-full max-w-5xl mx-auto"
            : "flex-1 min-h-0 overflow-y-auto w-full max-w-5xl mx-auto px-4 py-4 md:px-6 md:py-6"
        }
        style={
          showTabs
            ? { paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom))" }
            : undefined
        }
      >
        <Outlet />
      </main>
      {showTabs && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-4">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={Boolean(tab.end)}
                className={({ isActive }) =>
                  [
                    "min-h-[56px] flex items-center justify-center text-xs",
                    isActive ? "text-indigo-300" : "text-zinc-400",
                  ].join(" ")
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
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
  const { t } = useLocale();
  if (!online) {
    return (
      <span className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
        {t.offline}
        {pending > 0 ? ` · ${pending}` : ""}
      </span>
    );
  }
  if (pending > 0) {
    return (
      <span className="px-2 py-1 rounded bg-amber-900/40 border border-amber-700 text-amber-200">
        {pending} {t.pending}
      </span>
    );
  }
  if (result?.error && result.error !== "offline") {
    return (
      <span className="px-2 py-1 rounded bg-rose-900/40 border border-rose-700 text-rose-200">
        sync: {result.error}
      </span>
    );
  }
  return (
    <span className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-200">
      {t.synced}
    </span>
  );
}
