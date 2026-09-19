import { Link } from "react-router-dom";
import { useLocale } from "../context/LocaleContext";
import type { WeeklyReview } from "../lib/weeklyReview";

export default function WeeklyReviewCard({
  review,
  onSave,
}: {
  review: WeeklyReview;
  onSave?: () => void;
}) {
  const { t } = useLocale();
  const cur = review.current;
  const prev = review.previous;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t.weeklyTitle}</h2>
        <p className="text-xs text-zinc-500 mt-1">{t.weeklyHint}</p>
        <p className="text-[11px] text-zinc-500 mt-1">
          {cur.period.start_day} → {cur.period.end_day} · {cur.period.time_zone} · {review.built_at}
        </p>
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyQ1}</h3>
        <p className="text-xs text-zinc-400">
          {t.weeklyDays.replace("{n}", String(cur.days_with_observations)).replace("{d}", String(cur.period.calendar_days))}
        </p>
        {cur.coverage === "empty" ? (
          <p className="text-xs text-zinc-500">{t.weeklyEmpty}</p>
        ) : (
          <ul className="text-xs text-zinc-400 list-disc pl-4">
            {cur.metrics
              .filter((m) => m.present)
              .map((m) => (
                <li key={m.key}>
                  {t.weeklyMetricN
                    .replace("{label}", m.key)
                    .replace("{value}", String(m.mean))
                    .replace("{unit}", m.unit)
                    .replace("{n}", String(m.n))}
                  {m.min !== m.max ? ` · min ${m.min} / max ${m.max}` : ""}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyQ2}</h3>
        {cur.actions.length === 0 ? (
          <p className="text-xs text-zinc-500">{t.weeklyEmpty}</p>
        ) : (
          <ul className="text-xs text-zinc-400 space-y-1">
            {cur.actions.map((a) => (
              <li key={a.id}>
                <Link className="underline" to="/insights/life">
                  {a.proposal ?? a.id.slice(0, 8)}
                </Link>
                {` · ${a.state}`}
                {a.note === "action_has_no_feedback_in_period" ? ` · ${t.weeklyActionNoFeedback}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyQ3}</h3>
        <p className="text-[11px] text-amber-200/80">{t.weeklyHelpedVsProof}</p>
        {cur.feedback.length === 0 ? (
          <p className="text-xs text-zinc-500">{t.weeklyActionNoFeedback}</p>
        ) : (
          <ul className="text-xs text-zinc-400 list-disc pl-4">
            {cur.feedback.map((f) => (
              <li key={f.id}>
                {f.outcome_kind}
                {f.what_changed ? ` — ${f.what_changed}` : ""}
                {` · rec ${f.recorded_at?.slice(0, 10) ?? "?"} · obs ${f.observed_on ?? "—"}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyQ4}</h3>
        {cur.open_discussions.length > 0 && (
          <p className="text-xs text-zinc-400">
            {t.weeklyOpenDiscussions}: {cur.open_discussions.length}
          </p>
        )}
        <p className="text-xs text-zinc-500">{t.weeklyNoNextRequired}</p>
      </div>

      <div className="border-t border-zinc-800 pt-2 space-y-1">
        <div className="text-[11px] text-zinc-500">
          {t.weeklyPrev}: {prev.period.start_day} → {prev.period.end_day} · {prev.coverage}
        </div>
        <p className="text-[11px] text-zinc-500">{review.comparison.note}</p>
        {review.comparison.insufficient && <p className="text-[11px] text-amber-200/80">{t.weeklyIncomplete}</p>}
      </div>

      <div className="text-[11px] text-zinc-500">
        {t.weeklySources}: {review.sources.entry_ids.length} entries · {review.sources.action_ids.length} actions ·{" "}
        {review.sources.feedback_ids.length} feedback
        <div className="flex flex-wrap gap-1 mt-1">
          {review.sources.entry_ids.slice(0, 8).map((id) => (
            <Link key={id} className="underline" to="/timeline">
              {id.slice(0, 8)}
            </Link>
          ))}
        </div>
      </div>
      {onSave && (
        <button type="button" className="min-h-[36px] px-3 rounded bg-zinc-800 text-xs" onClick={onSave}>
          {t.weeklySave}
        </button>
      )}
    </section>
  );
}
