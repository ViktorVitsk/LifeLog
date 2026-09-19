import type { LifeBundle } from "./api.ts";
import { knownIso } from "./cacheFreshness.ts";
import { calendarDayKey, startOfLocalDay, startOfLocalDayBack } from "./dates.ts";

export const WEEKLY_REVIEW_FORMAT = 2;

export interface ReviewEntry {
  id: string;
  timestamp: string;
  entry_type: string;
  version?: number | null;
  mood_score?: number | null;
  energy_score?: number | null;
  anxiety_score?: number | null;
  focus_score?: number | null;
  stress_score?: number | null;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
}

export interface ReviewPeriod {
  start_day: string;
  end_day: string;
  start_iso: string;
  end_iso: string;
  time_zone: string;
  calendar_days: number;
}

export interface MetricStat {
  key: string;
  unit: string;
  n: number;
  n_days: number;
  mean?: number;
  mean_per_entry?: number;
  mean_per_day?: number;
  min?: number;
  max?: number;
  present: boolean;
  completeness: "none" | "partial" | "full";
  note?: string;
}

export interface WeekSlice {
  period: ReviewPeriod;
  days_with_observations: number;
  coverage: "full" | "partial" | "empty";
  metrics: MetricStat[];
  goals: { id: string; state: string; version?: number | null; title?: string }[];
  actions: {
    id: string;
    goal_id: string;
    state: string;
    state_is_current: true;
    started_at?: string | null;
    review_at?: string | null;
    version?: number | null;
    proposal?: string;
    feedback_in_period: number;
    note?: string;
  }[];
  feedback: {
    id: string;
    action_id: string;
    outcome_kind: string;
    outcome_source?: "user" | "unknown";
    decision?: string;
    recorded_at?: string | null;
    observed_on?: string | null;
    date_basis: "observed_on" | "recorded_at";
    in_period: boolean;
    late_about_past: boolean;
    what_changed?: string;
    plan_snapshot?: string;
    action_version?: number | null;
    version?: number | null;
  }[];
  late_feedback: WeekSlice["feedback"];
  open_discussions: { action_id: string; review_at: string }[];
  notes: string[];
}

export interface WeeklyReview {
  format_version: typeof WEEKLY_REVIEW_FORMAT;
  built_at: string;
  time_zone: string;
  current: WeekSlice;
  previous: WeekSlice;
  comparison: {
    same_rules: true;
    current_coverage: WeekSlice["coverage"];
    previous_coverage: WeekSlice["coverage"];
    metric_deltas: {
      key: string;
      current_n: number;
      previous_n: number;
      current_n_days: number;
      previous_n_days: number;
      mean_delta?: number;
      aggregation: "mean_per_day";
      note: string;
    }[];
    helped_is_not_proof: true;
    insufficient: boolean;
    both_weeks_have_observations_is_not_enough: true;
    note: string;
  };
  next_step_choices: string[];
  sources: {
    entry_ids: string[];
    goal_ids: string[];
    action_ids: string[];
    feedback_ids: string[];
    previous_entry_ids: string[];
    previous_feedback_ids: string[];
    versions: { kind: string; id: string; version?: number | null }[];
    preliminary: boolean;
    unresolved_conflicts: boolean;
  };
}

const SCORE_KEYS = new Set(["mood_score", "energy_score", "anxiety_score", "focus_score", "stress_score", "sleep_quality"]);

const METRICS: { key: keyof ReviewEntry; unit: string }[] = [
  { key: "mood_score", unit: "1–10" },
  { key: "energy_score", unit: "1–10" },
  { key: "anxiety_score", unit: "1–10" },
  { key: "focus_score", unit: "1–10" },
  { key: "stress_score", unit: "1–10" },
  { key: "sleep_hours", unit: "h" },
  { key: "sleep_quality", unit: "1–10" },
];

export function weekPeriods(now: Date, timeZone: string): { current: ReviewPeriod; previous: ReviewPeriod } {
  const current = {
    start_day: calendarDayKey(startOfLocalDayBack(now, 6, timeZone), timeZone),
    end_day: calendarDayKey(now, timeZone),
    start_iso: startOfLocalDayBack(now, 6, timeZone).toISOString(),
    end_iso: now.toISOString(),
    time_zone: timeZone,
    calendar_days: 7,
  };
  const prevEnd = new Date(startOfLocalDayBack(now, 6, timeZone).getTime() - 1);
  const previous = {
    start_day: calendarDayKey(startOfLocalDayBack(now, 13, timeZone), timeZone),
    end_day: calendarDayKey(prevEnd, timeZone),
    start_iso: startOfLocalDayBack(now, 13, timeZone).toISOString(),
    end_iso: startOfLocalDayBack(now, 6, timeZone).toISOString(),
    time_zone: timeZone,
    calendar_days: 7,
  };
  return { current, previous };
}

export function calendarDateKey(value: string, timeZone: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return calendarDayKey(value, timeZone);
}

function instantInPeriod(iso: string, period: ReviewPeriod): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(period.start_iso) && t <= Date.parse(period.end_iso);
}

function dayInPeriod(day: string, period: ReviewPeriod): boolean {
  return day >= period.start_day && day <= period.end_day;
}

export function classifyFeedbackDate(
  observedOn: string | null,
  recordedAt: string | null,
  period: ReviewPeriod,
): { date_basis: "observed_on" | "recorded_at"; result_day: string | null; in_period: boolean; late_about_past: boolean } {
  const tz = period.time_zone;
  if (observedOn) {
    const result_day = calendarDateKey(observedOn, tz);
    const recorded_day = recordedAt ? calendarDateKey(recordedAt, tz) : null;
    const in_period = Boolean(result_day && dayInPeriod(result_day, period));
    const late_about_past = Boolean(
      result_day &&
        !in_period &&
        recorded_day &&
        dayInPeriod(recorded_day, period) &&
        result_day < period.start_day,
    );
    return { date_basis: "observed_on", result_day, in_period, late_about_past };
  }
  if (recordedAt) {
    const result_day = calendarDateKey(recordedAt, tz);
    const in_period = Boolean(result_day && dayInPeriod(result_day, period) && instantInPeriod(recordedAt, period));
    return { date_basis: "recorded_at", result_day, in_period, late_about_past: false };
  }
  return { date_basis: "recorded_at", result_day: null, in_period: false, late_about_past: false };
}

function metricStats(entries: ReviewEntry[], period: ReviewPeriod): MetricStat[] {
  const tz = period.time_zone;
  return METRICS.map(({ key, unit }) => {
    const used = entries.filter((e) => typeof e[key] === "number" && Number.isFinite(e[key] as number));
    if (!used.length) {
      return { key, unit, n: 0, n_days: 0, present: false, completeness: "none", note: "missing_is_not_zero" };
    }
    const byDay = new Map<string, number[]>();
    for (const e of used) {
      const day = calendarDayKey(e.timestamp, tz);
      const list = byDay.get(day) ?? [];
      list.push(e[key] as number);
      byDay.set(day, list);
    }
    const dayMeans = [...byDay.values()].map((vals) => vals.reduce((a, b) => a + b, 0) / vals.length);
    const entryVals = used.map((e) => e[key] as number);
    const mean_per_entry = Math.round((entryVals.reduce((a, b) => a + b, 0) / entryVals.length) * 10) / 10;
    const mean_per_day = Math.round((dayMeans.reduce((a, b) => a + b, 0) / dayMeans.length) * 10) / 10;
    const completeness =
      byDay.size >= period.calendar_days ? "full" : byDay.size === 0 ? "none" : "partial";
    return {
      key,
      unit,
      n: entryVals.length,
      n_days: byDay.size,
      mean: mean_per_day,
      mean_per_entry,
      mean_per_day,
      min: Math.min(...entryVals),
      max: Math.max(...entryVals),
      present: true,
      completeness,
      note: SCORE_KEYS.has(String(key)) ? "day_mean_not_entry_mean" : undefined,
    };
  });
}

function actionSpansPeriod(a: { period_start?: string | null; period_end?: string | null; created_at?: string | null }, period: ReviewPeriod): boolean {
  const start = knownIso(a.period_start) ?? knownIso(a.created_at);
  const end = knownIso(a.period_end);
  if (!start && !end) return false;
  const startedByEnd = !start || Date.parse(start) <= Date.parse(period.end_iso);
  const notEndedBefore = !end || Date.parse(end) >= Date.parse(period.start_iso);
  return startedByEnd && notEndedBefore;
}

function sliceWeek(args: {
  period: ReviewPeriod;
  entries: ReviewEntry[];
  bundle: LifeBundle;
  goalPlain?: Record<string, Record<string, unknown>>;
  actionPlain?: Record<string, Record<string, unknown>>;
  feedbackPlain?: Record<string, Record<string, unknown>>;
}): WeekSlice {
  const { period, bundle } = args;
  const tz = period.time_zone;
  const entries = args.entries.filter((e) => instantInPeriod(e.timestamp, period) && dayInPeriod(calendarDayKey(e.timestamp, tz), period));
  const days = new Set(entries.map((e) => calendarDayKey(e.timestamp, tz)));
  const coverage: WeekSlice["coverage"] =
    days.size === 0 ? "empty" : days.size >= period.calendar_days ? "full" : "partial";

  const feedbackRows = bundle.feedback.map((f) => {
    const body = args.feedbackPlain?.[f.id];
    const recorded = knownIso(body?.recorded_at) ?? knownIso(f.created_at) ?? knownIso(f.updated_at);
    const observed = typeof body?.observed_on === "string" ? body.observed_on : null;
    const place = classifyFeedbackDate(observed, recorded, period);
    return {
      id: f.id,
      action_id: f.action_id,
      outcome_kind: f.outcome_kind,
      outcome_source: body?.outcome_source === "user" ? ("user" as const) : ("unknown" as const),
      decision: typeof body?.decision === "string" ? body.decision : undefined,
      recorded_at: recorded,
      observed_on: observed,
      date_basis: place.date_basis,
      in_period: place.in_period,
      late_about_past: place.late_about_past,
      what_changed: typeof body?.what_changed === "string" ? body.what_changed : undefined,
      plan_snapshot: typeof body?.plan_snapshot === "string" ? body.plan_snapshot : undefined,
      action_version: typeof body?.action_version === "number" ? body.action_version : f.version ?? null,
      version: f.version ?? null,
    };
  });
  const feedbackIn = feedbackRows.filter((f) => f.in_period);
  const late_feedback = feedbackRows.filter((f) => f.late_about_past);

  const actions = bundle.actions
    .filter((a) => actionSpansPeriod(a, period) || feedbackIn.some((f) => f.action_id === a.id))
    .map((a) => {
      const n = feedbackIn.filter((f) => f.action_id === a.id).length;
      const currentPlan =
        typeof args.actionPlain?.[a.id]?.proposal === "string"
          ? String(args.actionPlain[a.id].proposal)
          : typeof args.actionPlain?.[a.id]?.chosen_try === "string"
            ? String(args.actionPlain[a.id].chosen_try)
            : undefined;
      const snapshots = feedbackIn.map((f) => f.plan_snapshot).filter((x): x is string => Boolean(x));
      const planChanged = snapshots.some((s) => currentPlan && s !== currentPlan);
      return {
        id: a.id,
        goal_id: a.goal_id,
        state: a.state,
        state_is_current: true as const,
        started_at: a.period_start ?? (knownIso(a.created_at) || null),
        review_at: a.review_at ?? null,
        version: a.version ?? null,
        proposal: currentPlan,
        feedback_in_period: n,
        note:
          n === 0
            ? "action_has_no_feedback_in_period"
            : planChanged
              ? "feedback_tied_to_earlier_plan"
              : "current_state_not_period_history",
      };
    });

  const goalIds = new Set(actions.map((a) => a.goal_id));
  const goals = bundle.goals
    .filter((g) => goalIds.has(g.id) || (g.review_at && instantInPeriod(g.review_at, period)))
    .map((g) => ({
      id: g.id,
      state: g.state,
      version: g.version ?? null,
      title: typeof args.goalPlain?.[g.id]?.title === "string" ? String(args.goalPlain[g.id].title) : undefined,
    }));

  const open_discussions = bundle.actions
    .filter((a) => (a.state === "accepted" || a.state === "active") && a.review_at && Date.parse(a.review_at) <= Date.parse(period.end_iso))
    .map((a) => ({ action_id: a.id, review_at: a.review_at as string }));

  const notes: string[] = [];
  if (coverage === "empty") notes.push("no_observations");
  if (actions.some((a) => a.feedback_in_period === 0)) notes.push("action_without_feedback");
  if (late_feedback.length) notes.push("late_feedback_about_past");
  if (feedbackRows.some((f) => f.date_basis === "recorded_at" && f.in_period)) notes.push("recorded_at_used_as_result_date");
  notes.push("helped_is_subjective");
  notes.push("current_action_state_is_not_history");

  return {
    period,
    days_with_observations: days.size,
    coverage,
    metrics: metricStats(entries, period),
    goals,
    actions,
    feedback: feedbackIn,
    late_feedback,
    open_discussions,
    notes,
  };
}

export function buildWeeklyReview(args: {
  now: Date;
  timeZone: string;
  entries: ReviewEntry[];
  bundle: LifeBundle;
  goalPlain?: Record<string, Record<string, unknown>>;
  actionPlain?: Record<string, Record<string, unknown>>;
  feedbackPlain?: Record<string, Record<string, unknown>>;
  conflictIds?: string[];
}): WeeklyReview {
  const { current, previous } = weekPeriods(args.now, args.timeZone);
  const cur = sliceWeek({ period: current, ...args });
  const prev = sliceWeek({ period: previous, ...args });
  const metric_deltas = cur.metrics.map((m) => {
    const p = prev.metrics.find((x) => x.key === m.key);
    const enough = (m.n_days ?? 0) >= 3 && (p?.n_days ?? 0) >= 3;
    if (!m.present || !p?.present) {
      return {
        key: m.key,
        current_n: m.n,
        previous_n: p?.n ?? 0,
        current_n_days: m.n_days,
        previous_n_days: p?.n_days ?? 0,
        aggregation: "mean_per_day" as const,
        note: "missing_is_not_zero",
      };
    }
    return {
      key: m.key,
      current_n: m.n,
      previous_n: p.n,
      current_n_days: m.n_days,
      previous_n_days: p.n_days,
      mean_delta: enough ? Math.round(((m.mean_per_day ?? 0) - (p.mean_per_day ?? 0)) * 10) / 10 : undefined,
      aggregation: "mean_per_day" as const,
      note: enough ? "day_mean_same_rule" : "both_weeks_present_is_not_enough",
    };
  });
  const jointEnough = metric_deltas.some((d) => d.note === "day_mean_same_rule");
  const insufficient = !jointEnough;
  const sources = {
    entry_ids: args.entries.filter((e) => instantInPeriod(e.timestamp, current)).map((e) => e.id),
    goal_ids: [...new Set([...cur.goals, ...prev.goals].map((g) => g.id))],
    action_ids: [...new Set([...cur.actions, ...prev.actions].map((a) => a.id))],
    feedback_ids: cur.feedback.map((f) => f.id),
    previous_entry_ids: args.entries.filter((e) => instantInPeriod(e.timestamp, previous)).map((e) => e.id),
    previous_feedback_ids: prev.feedback.map((f) => f.id),
    versions: [
      ...args.entries.map((e) => ({ kind: "entry" as const, id: e.id, version: e.version })),
      ...cur.goals.map((g) => ({ kind: "goal" as const, id: g.id, version: g.version })),
      ...cur.actions.map((a) => ({ kind: "action" as const, id: a.id, version: a.version })),
      ...cur.feedback.map((f) => ({ kind: "feedback" as const, id: f.id, version: f.version })),
      ...prev.feedback.map((f) => ({ kind: "feedback" as const, id: f.id, version: f.version })),
    ],
    preliminary: Boolean(args.conflictIds?.length),
    unresolved_conflicts: Boolean(args.conflictIds?.length),
  };
  return {
    format_version: WEEKLY_REVIEW_FORMAT,
    built_at: args.now.toISOString(),
    time_zone: args.timeZone,
    current: cur,
    previous: prev,
    comparison: {
      same_rules: true,
      current_coverage: cur.coverage,
      previous_coverage: prev.coverage,
      metric_deltas,
      helped_is_not_proof: true,
      insufficient,
      both_weeks_have_observations_is_not_enough: true,
      note: insufficient
        ? "Not enough paired daily observations for a confident week-to-week claim. Presence in both weeks is not enough."
        : "Day means use the same rule. Subjective “helped” is not a proven effect.",
    },
    next_step_choices: [
      "keep observing without a new action",
      "postpone a due discussion",
      "record another result for an existing action",
      "change the plan of an existing action",
      "do nothing this week",
    ],
    sources,
  };
}

export { startOfLocalDay };
