import { Link } from "react-router-dom";
import { useLocale } from "../context/LocaleContext";
import type { TStrings } from "../i18n/strings";
import { metricLabel } from "../i18n/strings";
import type { WeeklyReview, WeekSlice } from "../lib/weeklyReview";

function coverageLabel(t: TStrings, coverage: WeekSlice["coverage"]): string {
  if (coverage === "full") return t.weeklyCoverageFull;
  if (coverage === "empty") return t.weeklyCoverageEmpty;
  return t.weeklyCoveragePartial;
}

function outcomeLabel(kind: string, t: TStrings): string {
  if (kind === "not_tried") return t.outcomeNotTried;
  if (kind === "not_suitable") return t.outcomeNotSuitable;
  if (kind === "tried_no_effect") return t.outcomeNoEffect;
  if (kind === "tried_helped") return t.outcomeHelped;
  if (kind === "unevaluated") return t.outcomeUnevaluated;
  return kind;
}

function decisionLabel(kind: string, t: TStrings): string {
  if (kind === "continue") return t.lifeContinue;
  if (kind === "change_plan") return t.lifeDecisionChangePlan;
  if (kind === "complete") return t.lifeComplete;
  if (kind === "stop") return t.lifeStop;
  return kind;
}

function actionHref(id: string, focus?: "result" | "postpone"): string {
  const extra = focus === "result" ? "&focus=result" : focus === "postpone" ? "&focus=postpone" : "";
  return `/insights/life?action=${encodeURIComponent(id)}${extra}`;
}

function entryHref(id: string): string {
  return `/timeline?entry=${encodeURIComponent(id)}`;
}

function fmt(n: number | undefined): string {
  return n == null || Number.isNaN(n) ? "—" : String(n);
}

export default function WeeklyReviewCard({
  review,
  onSave,
  knownEntryIds,
  knownActionIds,
}: {
  review: WeeklyReview;
  onSave?: () => void;
  knownEntryIds?: Set<string>;
  knownActionIds?: Set<string>;
}) {
  const { t } = useLocale();
  const cur = review.current;
  const prev = review.previous;
  const sourceEntries = [...review.sources.previous_entry_ids, ...review.sources.entry_ids];
  const sourceActions = review.sources.action_ids;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t.weeklyTitle}</h2>
        <p className="text-xs text-zinc-500 mt-1">{t.weeklyHint}</p>
        <p className="text-[11px] text-zinc-500 mt-1">
          {cur.period.start_day} → {cur.period.end_day} · {cur.period.time_zone}
        </p>
      </div>

      {review.sources.unresolved_conflicts && (
        <p className="text-xs text-amber-200/90">{t.weeklyConflicts}</p>
      )}
      {review.sources.preliminary && !review.sources.unresolved_conflicts && (
        <p className="text-xs text-amber-200/90">{t.weeklyPreliminary}</p>
      )}

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyCompare}</h3>
        <p className="text-[11px] text-zinc-500">
          {t.weeklyThisWeek}: {coverageLabel(t, cur.coverage)} · {t.weeklyLastWeek}: {coverageLabel(t, prev.coverage)}
        </p>
        <p className="text-[11px] text-zinc-500">{t.weeklyMeanDay}</p>
        <ul className="mt-1 space-y-1">
          {review.comparison.metric_deltas.map((d) => {
            const curM = cur.metrics.find((m) => m.key === d.key);
            const prevM = prev.metrics.find((m) => m.key === d.key);
            if (!curM?.present && !prevM?.present) return null;
            const label = metricLabel(t, d.key);
            const unit = curM?.unit ?? prevM?.unit ?? "";
            const note =
              d.note === "both_weeks_present_is_not_enough"
                ? t.weeklyBothWeeksNotEnough
                : d.note === "missing_is_not_zero"
                  ? t.weeklyNoDelta
                  : d.mean_delta == null
                    ? t.weeklyNoDelta
                    : undefined;
            return (
              <li key={d.key} className="text-xs text-zinc-300 rounded border border-zinc-800 px-2 py-1">
                <div className="font-medium">{label}</div>
                <div className="text-zinc-400">
                  {t.weeklyThisWeek}: {fmt(curM?.mean_per_day)} {unit} · {d.current_n} {t.weeklyObs} / {d.current_n_days}{" "}
                  {t.weeklyDaysShort}
                  {curM?.mean_per_entry != null && curM.mean_per_entry !== curM.mean_per_day
                    ? ` · ${t.weeklyMeanEntry} ${fmt(curM.mean_per_entry)}`
                    : ""}
                </div>
                <div className="text-zinc-400">
                  {t.weeklyLastWeek}: {fmt(prevM?.mean_per_day)} {unit} · {d.previous_n} {t.weeklyObs} / {d.previous_n_days}{" "}
                  {t.weeklyDaysShort}
                </div>
                <div>
                  {t.weeklyDelta}: {d.mean_delta == null ? "—" : d.mean_delta > 0 ? `+${d.mean_delta}` : String(d.mean_delta)}
                </div>
                {note && <div className="text-[11px] text-amber-200/80">{note}</div>}
              </li>
            );
          })}
        </ul>
        {review.comparison.insufficient && <p className="text-xs text-amber-200/80 mt-1">{t.weeklyIncomplete}</p>}
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyQ2}</h3>
        {cur.actions.length === 0 ? (
          <p className="text-xs text-zinc-500">{t.weeklyEmpty}</p>
        ) : (
          <ul className="text-xs text-zinc-400 space-y-2">
            {cur.actions.map((a) => {
              const missing = knownActionIds ? !knownActionIds.has(a.id) : false;
              return (
                <li key={a.id} className="rounded border border-zinc-800 px-2 py-1 space-y-1">
                  {missing ? (
                    <span>{t.weeklySourceMissing}</span>
                  ) : (
                    <Link className="underline text-zinc-200" to={actionHref(a.id)}>
                      {a.proposal ?? a.id.slice(0, 8)}
                    </Link>
                  )}
                  <div>
                    {a.state} · {t.weeklyStateCurrent}
                    {a.note === "action_has_no_feedback_in_period" ? ` · ${t.weeklyActionNoFeedback}` : ""}
                    {a.note === "feedback_tied_to_earlier_plan" ? ` · ${t.weeklyEarlierPlan}` : ""}
                  </div>
                  {!missing && (
                    <div className="flex flex-wrap gap-2">
                      <Link className="underline" to={actionHref(a.id, "result")}>
                        {t.weeklyRecordResult}
                      </Link>
                      <Link className="underline" to={actionHref(a.id, "postpone")}>
                        {t.weeklyPostponeDiscuss}
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyQ3}</h3>
        <p className="text-[11px] text-amber-200/80">{t.weeklyHelpedVsProof}</p>
        {cur.feedback.length === 0 ? (
          <p className="text-xs text-zinc-500">{t.weeklyActionNoFeedback}</p>
        ) : (
          <ul className="text-xs text-zinc-400 space-y-1">
            {cur.feedback.map((f) => (
              <li key={f.id}>
                <Link className="underline text-zinc-200" to={actionHref(f.action_id, "result")}>
                  {outcomeLabel(f.outcome_kind, t)}
                </Link>
                {f.decision ? ` · ${decisionLabel(f.decision, t)}` : ""}
                {f.what_changed ? ` — ${f.what_changed}` : ""}
                <div className="text-[11px] text-zinc-500">
                  {f.date_basis === "observed_on" ? t.weeklyDateObserved : t.weeklyDateRecorded}
                  {f.observed_on ? ` · ${f.observed_on}` : ""}
                  {f.recorded_at ? ` · ${f.recorded_at.slice(0, 10)}` : ""}
                  {f.plan_snapshot ? ` · ${f.plan_snapshot}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
        {cur.late_feedback.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] text-zinc-500">{t.weeklyLate}</p>
            <ul className="text-xs text-zinc-400 list-disc pl-4">
              {cur.late_feedback.map((f) => (
                <li key={f.id}>
                  <Link className="underline" to={actionHref(f.action_id)}>
                    {outcomeLabel(f.outcome_kind, t)}
                  </Link>
                  {f.observed_on ? ` · ${f.observed_on}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-300">{t.weeklyQ4}</h3>
        {cur.open_discussions.length > 0 && (
          <ul className="text-xs text-zinc-400 space-y-1">
            {cur.open_discussions.map((d) => (
              <li key={d.action_id}>
                <Link className="underline" to={actionHref(d.action_id, "postpone")}>
                  {t.weeklyPostponeDiscuss}
                </Link>
                {` · ${d.review_at.slice(0, 10)}`}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">{t.weeklyNoNextRequired}</p>
      </div>

      <div className="border-t border-zinc-800 pt-2 space-y-1">
        <div className="text-[11px] text-zinc-500">
          {t.weeklyPrev}: {prev.period.start_day} → {prev.period.end_day} · {coverageLabel(t, prev.coverage)}
        </div>
      </div>

      <div className="text-[11px] text-zinc-500">
        {t.weeklySources}
        <div className="flex flex-wrap gap-1 mt-1">
          {sourceEntries.map((id) => {
            const missing = knownEntryIds ? !knownEntryIds.has(id) : false;
            return missing ? (
              <span key={id} title={t.weeklySourceMissing}>
                {t.weeklySourceEntry} {id.slice(0, 8)} — {t.weeklySourceMissing}
              </span>
            ) : (
              <Link key={id} className="underline" to={entryHref(id)}>
                {t.weeklySourceEntry} {id.slice(0, 8)}
              </Link>
            );
          })}
          {sourceActions.map((id) => {
            const missing = knownActionIds ? !knownActionIds.has(id) : false;
            return missing ? (
              <span key={`a-${id}`}>{t.weeklySourceAction} — {t.weeklySourceMissing}</span>
            ) : (
              <Link key={`a-${id}`} className="underline" to={actionHref(id)}>
                {t.weeklySourceAction} {id.slice(0, 8)}
              </Link>
            );
          })}
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
