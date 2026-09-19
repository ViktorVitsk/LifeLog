import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeeklyReview } from "./weeklyReview.ts";
import type { LifeBundle } from "./api.ts";

/** 14 calendar days ending 2026-09-19 15:00 UTC. Expected numbers are fixed here, not derived in the assertion. */
const NOW = new Date("2026-09-19T15:00:00.000Z");
const TZ = "UTC";

const EXPECTED = {
  current_days: 4,
  previous_days: 4,
  previous_mood_entry_mean: 6,
  previous_mood_day_mean: 6,
  previous_mood_n: 5,
  previous_mood_n_days: 4,
  current_mood_entry_mean: 6.8,
  current_mood_day_mean: 6.8,
  current_mood_n: 6,
  current_mood_n_days: 4,
  current_feedback_ids: ["f-now", "f-recorded"],
  previous_feedback_ids: ["f-old-week", "f-late"],
  current_late_ids: ["f-late"],
  excludes_future: "e-future",
};

function bundle(): LifeBundle {
  return {
    goals: [
      {
        id: "g1",
        state: "active",
        encrypted_dek: "d",
        encrypted_content: "c",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
        version: 1,
      },
    ],
    memory: [],
    actions: [
      {
        id: "a-long",
        goal_id: "g1",
        state: "accepted",
        period_start: "2026-08-02T10:00:00.000Z",
        review_at: "2026-09-26T12:00:00.000Z",
        encrypted_dek: "d",
        encrypted_content: "c",
        created_at: "2026-08-02T10:00:00.000Z",
        updated_at: "2026-09-16T10:00:00.000Z",
        version: 4,
      },
      {
        id: "a-empty",
        goal_id: "g1",
        state: "accepted",
        period_start: "2026-09-07T10:00:00.000Z",
        review_at: "2026-09-28T12:00:00.000Z",
        encrypted_dek: "d",
        encrypted_content: "c",
        created_at: "2026-09-07T10:00:00.000Z",
        updated_at: "2026-09-07T10:00:00.000Z",
        version: 1,
      },
    ],
    feedback: [
      {
        id: "f-old-week",
        action_id: "a-long",
        outcome_kind: "tried_no_effect",
        encrypted_dek: "d",
        encrypted_content: "c",
        created_at: "2026-09-08T20:00:00.000Z",
        updated_at: "2026-09-08T20:00:00.000Z",
        version: 1,
      },
      {
        id: "f-late",
        action_id: "a-long",
        outcome_kind: "tried_helped",
        encrypted_dek: "d",
        encrypted_content: "c",
        created_at: "2026-09-15T09:00:00.000Z",
        updated_at: "2026-09-15T09:00:00.000Z",
        version: 1,
      },
      {
        id: "f-now",
        action_id: "a-long",
        outcome_kind: "unevaluated",
        encrypted_dek: "d",
        encrypted_content: "c",
        created_at: "2026-09-17T18:00:00.000Z",
        updated_at: "2026-09-17T18:00:00.000Z",
        version: 1,
      },
      {
        id: "f-recorded",
        action_id: "a-long",
        outcome_kind: "tried_helped",
        encrypted_dek: "d",
        encrypted_content: "c",
        created_at: "2026-09-18T11:00:00.000Z",
        updated_at: "2026-09-18T11:00:00.000Z",
        version: 1,
      },
    ],
    due_action_ids: [],
  };
}

describe("weekly review 14-day fixture", () => {
  const review = buildWeeklyReview({
    now: NOW,
    timeZone: TZ,
    entries: [
      { id: "e-p1", timestamp: "2026-09-06T10:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 6, version: 1 },
      { id: "e-p2a", timestamp: "2026-09-08T08:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 4, version: 1 },
      { id: "e-p2b", timestamp: "2026-09-08T20:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 8, version: 1 },
      { id: "e-p3", timestamp: "2026-09-10T10:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 5, version: 1 },
      { id: "e-p4", timestamp: "2026-09-12T10:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 7, version: 1 },
      { id: "e-c1", timestamp: "2026-09-13T10:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 8, version: 1 },
      { id: "e-c2a", timestamp: "2026-09-15T08:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 6, version: 1 },
      { id: "e-c2b", timestamp: "2026-09-15T12:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 6, version: 1 },
      { id: "e-c2c", timestamp: "2026-09-15T14:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 9, version: 1 },
      { id: "e-c3", timestamp: "2026-09-17T10:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 5, version: 1 },
      { id: "e-c4", timestamp: "2026-09-19T10:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 7, version: 1 },
      { id: EXPECTED.excludes_future, timestamp: "2026-09-19T18:00:00.000Z", entry_type: "DAILY_CHECKIN", mood_score: 9, version: 1 },
    ],
    bundle: bundle(),
    actionPlain: { "a-long": { proposal: "Телефон в другой комнате", chosen_try: "Телефон в другой комнате" } },
    feedbackPlain: {
      "f-old-week": { observed_on: "2026-09-08", outcome_source: "user", plan_snapshot: "Экраны в 23:00", action_version: 2 },
      "f-late": { observed_on: "2026-09-10", recorded_at: "2026-09-15T09:00:00.000Z", outcome_source: "user", plan_snapshot: "Экраны в 23:00", action_version: 2 },
      "f-now": { observed_on: "2026-09-17", outcome_source: "user", plan_snapshot: "Телефон в другой комнате", action_version: 4 },
      "f-recorded": { outcome_source: "user", decision: "continue" },
    },
  });

  it("uses the pre-declared day and mean numbers", () => {
    const prev = review.previous.metrics.find((m) => m.key === "mood_score");
    const cur = review.current.metrics.find((m) => m.key === "mood_score");
    assert.equal(review.previous.days_with_observations, EXPECTED.previous_days);
    assert.equal(review.current.days_with_observations, EXPECTED.current_days);
    assert.equal(prev?.n, EXPECTED.previous_mood_n);
    assert.equal(prev?.n_days, EXPECTED.previous_mood_n_days);
    assert.equal(prev?.mean_per_entry, EXPECTED.previous_mood_entry_mean);
    assert.equal(prev?.mean_per_day, EXPECTED.previous_mood_day_mean);
    assert.equal(cur?.n, EXPECTED.current_mood_n);
    assert.equal(cur?.n_days, EXPECTED.current_mood_n_days);
    assert.equal(cur?.mean_per_entry, EXPECTED.current_mood_entry_mean);
    assert.equal(cur?.mean_per_day, EXPECTED.current_mood_day_mean);
    assert.equal(review.sources.entry_ids.includes(EXPECTED.excludes_future), false);
  });

  it("places late feedback in the observed week, not twice", () => {
    assert.deepEqual(review.current.feedback.map((f) => f.id).sort(), [...EXPECTED.current_feedback_ids].sort());
    assert.deepEqual(review.previous.feedback.map((f) => f.id).sort(), [...EXPECTED.previous_feedback_ids].sort());
    assert.deepEqual(review.current.late_feedback.map((f) => f.id), EXPECTED.current_late_ids);
    assert.equal(review.current.feedback.find((f) => f.id === "f-recorded")?.date_basis, "recorded_at");
    assert.ok(review.current.notes.includes("recorded_at_used_as_result_date"));
    assert.ok(review.current.notes.includes("late_feedback_about_past"));
  });

  it("keeps an August action visible and does not treat current state as last week's history", () => {
    assert.ok(review.current.actions.some((a) => a.id === "a-long"));
    assert.ok(review.previous.actions.some((a) => a.id === "a-long"));
    assert.ok(review.current.actions.some((a) => a.id === "a-empty" && a.note === "action_has_no_feedback_in_period"));
    assert.equal(review.current.actions.find((a) => a.id === "a-long")?.state_is_current, true);
    assert.deepEqual(
      review.previous.feedback.map((f) => ({ id: f.id, snap: f.plan_snapshot })),
      [
        { id: "f-old-week", snap: "Экраны в 23:00" },
        { id: "f-late", snap: "Экраны в 23:00" },
      ],
    );
    assert.equal(review.comparison.both_weeks_have_observations_is_not_enough, true);
    const moodDelta = review.comparison.metric_deltas.find((d) => d.key === "mood_score");
    assert.equal(moodDelta?.aggregation, "mean_per_day");
    assert.equal(review.current.metrics.find((m) => m.key === "sleep_hours")?.present, false);
  });
});
