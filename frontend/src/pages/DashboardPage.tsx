import MoodTrendChart from "../components/dashboard/MoodTrendChart";
import RecentEntries from "../components/dashboard/RecentEntries";
import TodayWidgets from "../components/dashboard/TodayWidgets";
import { useEntries } from "../hooks/useEntries";
import { isNetworkError } from "../lib/api";

export default function DashboardPage() {
  const { entries, isLoading, error, pendingCount } = useEntries();
  const offline: boolean = error ? isNetworkError(error) : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Aggregates open numeric metrics only — your notes stay encrypted.
        </p>
      </div>

      {offline ? (
        <div className="rounded border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-xs p-2">
          Offline — showing locally stored entries. Sync will resume automatically.
        </div>
      ) : error ? (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          Failed to load entries: {error.message}
        </div>
      ) : null}

      <TodayWidgets entries={entries} />

      <MoodTrendChart entries={entries} days={30} />

      <RecentEntries entries={entries} />

      <div className="text-[11px] text-zinc-500">
        {isLoading ? "loading…" : `${entries.length} entries`}
        {pendingCount > 0 && ` · ${pendingCount} not yet synced`}
      </div>
    </div>
  );
}
