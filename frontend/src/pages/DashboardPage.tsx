import MoodTrendChart from "../components/dashboard/MoodTrendChart";
import RecentEntries from "../components/dashboard/RecentEntries";
import TodayWidgets from "../components/dashboard/TodayWidgets";
import WeeklyReviewCard from "../components/WeeklyReviewCard";
import { useDecryptedMap } from "../components/CipherCard";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useEntries } from "../hooks/useEntries";
import { useMergedLife } from "../hooks/useMergedLife";
import { isNetworkError } from "../lib/api";
import { getAccountTimeZone } from "../lib/dates";
import { buildWeeklyReview } from "../lib/weeklyReview";

export default function DashboardPage() {
  const { t } = useLocale();
  const { kek, timezone } = useAuth();
  const { entries, isLoading, error, pendingCount } = useEntries();
  const life = useMergedLife();
  const goalPlain = useDecryptedMap(life.bundle.goals, kek);
  const actionPlain = useDecryptedMap(life.bundle.actions, kek);
  const feedbackPlain = useDecryptedMap(life.bundle.feedback, kek);
  const weekly = buildWeeklyReview({
    now: new Date(),
    timeZone: timezone || getAccountTimeZone(),
    entries,
    bundle: life.bundle,
    goalPlain,
    actionPlain,
    feedbackPlain,
  });
  const offline: boolean = error ? isNetworkError(error) : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.dashboardTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.dashboardHint}</p>
      </div>

      {offline ? (
        <div className="rounded border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-xs p-2">
          {t.offlineLocal}
        </div>
      ) : error ? (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {t.loadFailed}: {error.message}
        </div>
      ) : null}

      <WeeklyReviewCard review={weekly} />

      <TodayWidgets entries={entries} />

      <MoodTrendChart entries={entries} days={30} />

      <RecentEntries entries={entries} />

      <div className="text-[11px] text-zinc-500">
        {isLoading ? t.loading : `${entries.length} ${t.entriesCount}`}
        {pendingCount > 0 && ` · ${pendingCount} ${t.notSynced}`}
      </div>
    </div>
  );
}
