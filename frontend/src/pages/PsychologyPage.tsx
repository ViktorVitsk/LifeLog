import EmotionalHistory from "../components/psychology/EmotionalHistory";
import GapChart from "../components/psychology/GapChart";
import GratitudeLog from "../components/psychology/GratitudeLog";
import PatternInsights from "../components/psychology/PatternInsights";
import { useLocale } from "../context/LocaleContext";
import { useEntries } from "../hooks/useEntries";
import { isNetworkError } from "../lib/api";

export default function PsychologyPage() {
  const { t } = useLocale();
  const { entries, isLoading, error } = useEntries();
  const offline: boolean = error ? isNetworkError(error) : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.psychologyTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.psychologyHint}</p>
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

      <GapChart entries={entries} days={30} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PatternInsights entries={entries} days={30} />
        <GratitudeLog entries={entries} />
      </div>

      <EmotionalHistory entries={entries} />

      <div className="text-[11px] text-zinc-500">
        {isLoading ? t.loading : t.entriesTotal.replace("{n}", String(entries.length))}
      </div>
    </div>
  );
}
