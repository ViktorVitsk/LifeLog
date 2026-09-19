import type { LifeBundle } from "./api.ts";
import { calendarDayKey, startOfLocalDay, startOfLocalDayBack } from "./dates.ts";

export const WEEKLY_REVIEW_FORMAT = 1;

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
  mean?: number;
  min?: number;
  max?: number;
  present: boolean;
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
    recorded_at?: string | null;
    observed_on?: string | null;
    in_period: boolean;
    what_changed?: string;
    version?: number | null;
  }[];
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
    metric_deltas: { key: string; current_n: number; previous_n: number; mean_delta?: number; note: string }[];
    helped_is_not_proof: true;
    insufficient: boolean;
    note: string;
  };
  next_step_choices: string[];
  sources: {
    entry_ids: string[];
    goal_ids: string[];
    action_ids: string[];
    feedback_ids: string[];
    versions: { kind: string; id: string; version?: number | null }[];
  };
}

const METRICS: { key: keyof ReviewEntry; unit: string }[] = [
  { key: "mood_score", unit: "0–10" },
  { key: "energy_score", unit: "0–10" },
  { key: "anxiety_score", unit: "0–10" },
  { key: "focus_score", unit: "0–10" },
  { key: "stress_score", unit: "0–10" },
  { key: "sleep_hours", unit: "h" },
  { key: "sleep_quality", unit: "0–10" },
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

function dayInPeriod(iso: string, period: ReviewPeriod, timeZone: string): boolean {
  const day = calendarDayKey(iso, timeZone);
  return day >= period.start_day && day <= period.end_day;
}

function metricStats(entries: ReviewEntry[]): MetricStat[] {
  return METRICS.map(({ key, unit }) => {
    const values = entries.map((e) => e[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!values.length) return { key, unit, n: 0, present: false };
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      key,
      unit,
      n: values.length,
      mean: Math.round((sum / values.length) * 10) / 10,
      min: Math.min(...values),
      max: Math.max(...values),
      present: true,
    };
  });
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
  const entries = args.entries.filter((e) => dayInPeriod(e.timestamp, period, tz));
  const days = new Set(entries.map((e) => calendarDayKey(e.timestamp, tz)));
  const coverage: WeekSlice["coverage"] =
    days.size === 0 ? "empty" : days.size >= period.calendar_days ? "full" : "partial";

  const feedbackRows = bundle.feedback.map((f) => {
    const body = args.feedbackPlain?.[f.id];
    const recorded = f.created_at ?? f.updated_at ?? null;
    const observed = typeof body?.observed_on === "string" ? body.observed_on : null;
    const in_period = Boolean((recorded && dayInPeriod(recorded, period, tz)) || (observed && dayInPeriod(observed, period, tz)));
    return {
      id: f.id,
      action_id: f.action_id,
      outcome_kind: f.outcome_kind,
      recorded_at: recorded,
      observed_on: observed,
      in_period,
      what_changed: typeof body?.what_changed === "string" ? body.what_changed : undefined,
      version: f.version ?? null,
    };
  });
  const feedbackIn = feedbackRows.filter((f) => f.in_period);

  const actions = bundle.actions
    .filter((a) => {
      const started = a.period_start ?? a.created_at;
      const reviewed = a.review_at;
      const created = a.created_at;
      return (
        (started && dayInPeriod(started, period, tz)) ||
        (reviewed && dayInPeriod(reviewed, period, tz)) ||
        (created && dayInPeriod(created, period, tz)) ||
        feedbackIn.some((f) => f.action_id === a.id)
      );
    })
    .map((a) => {
      const n = feedbackIn.filter((f) => f.action_id === a.id).length;
      return {
        id: a.id,
        goal_id: a.goal_id,
        state: a.state,
        started_at: a.period_start ?? a.created_at ?? null,
        review_at: a.review_at ?? null,
        version: a.version ?? null,
        proposal: typeof args.actionPlain?.[a.id]?.proposal === "string"
          ? String(args.actionPlain[a.id].proposal)
          : typeof args.actionPlain?.[a.id]?.chosen_try === "string"
            ? String(args.actionPlain[a.id].chosen_try)
            : undefined,
        feedback_in_period: n,
        note: n === 0 ? "action_has_no_feedback_in_period" : undefined,
      };
    });

  const goalIds = new Set(actions.map((a) => a.goal_id));
  const goals = bundle.goals
    .filter((g) => goalIds.has(g.id) || (g.review_at && dayInPeriod(g.review_at, period, tz)))
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
  if (feedbackRows.some((f) => !f.in_period)) notes.push("older_feedback_excluded");
  notes.push("helped_is_subjective");

  return {
    period,
    days_with_observations: days.size,
    coverage,
    metrics: metricStats(entries),
    goals,
    actions,
    feedback: feedbackIn,
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
}): WeeklyReview {
  const { current, previous } = weekPeriods(args.now, args.timeZone);
  const cur = sliceWeek({ period: current, ...args });
  const prev = sliceWeek({ period: previous, ...args });
  const metric_deltas = cur.metrics.map((m) => {
    const p = prev.metrics.find((x) => x.key === m.key);
    if (!m.present || !p?.present) {
      return {
        key: m.key,
        current_n: m.n,
        previous_n: p?.n ?? 0,
        note: "missing_is_not_zero",
      };
    }
    return {
      key: m.key,
      current_n: m.n,
      previous_n: p.n,
      mean_delta: Math.round(((m.mean ?? 0) - (p.mean ?? 0)) * 10) / 10,
      note: "same_aggregation_rule",
    };
  });
  const insufficient = cur.coverage === "empty" || (cur.days_with_observations < 3 && prev.coverage === "empty");
  const sources = {
    entry_ids: args.entries.filter((e) => dayInPeriod(e.timestamp, current, args.timeZone)).map((e) => e.id),
    goal_ids: cur.goals.map((g) => g.id),
    action_ids: cur.actions.map((a) => a.id),
    feedback_ids: cur.feedback.map((f) => f.id),
    versions: [
      ...cur.goals.map((g) => ({ kind: "goal" as const, id: g.id, version: g.version })),
      ...cur.actions.map((a) => ({ kind: "action" as const, id: a.id, version: a.version })),
      ...cur.feedback.map((f) => ({ kind: "feedback" as const, id: f.id, version: f.version })),
    ],
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
      note: insufficient
        ? "Not enough observations for a confident week-to-week claim. Absence is a gap, not a zero."
        : "Numbers come from stored fields. Subjective “helped” is not a proven effect.",
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
