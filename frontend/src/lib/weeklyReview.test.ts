import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeeklyReview, weekPeriods } from "./weeklyReview.ts";
import type { LifeBundle } from "./api.ts";

const emptyBundle = (): LifeBundle => ({
  goals: [],
  memory: [],
  actions: [],
  feedback: [],
  due_action_ids: [],
});

describe("weekly review", () => {
  it("uses calendar weeks, not 6*24h, across Berlin DST", () => {
    const now = new Date("2026-03-30T12:00:00.000Z");
    const { current, previous } = weekPeriods(now, "Europe/Berlin");
    assert.equal(current.start_day, "2026-03-24");
    assert.equal(current.end_day, "2026-03-30");
    assert.equal(previous.start_day, "2026-03-17");
    assert.equal(previous.end_day, "2026-03-23");
    assert.equal(current.calendar_days, 7);
  });

  it("treats an empty week as a gap, not a zero score", () => {
    const review = buildWeeklyReview({
      now: new Date("2026-09-19T12:00:00.000Z"),
      timeZone: "UTC",
      entries: [],
      bundle: emptyBundle(),
    });
    assert.equal(review.current.coverage, "empty");
    assert.equal(review.current.days_with_observations, 0);
    assert.equal(review.current.metrics.every((m) => m.present === false && m.n === 0), true);
    assert.equal(review.comparison.insufficient, true);
    assert.match(review.comparison.note, /gap|Not enough/i);
    assert.ok(review.next_step_choices.includes("do nothing this week"));
  });

  it("keeps feedback time semantics and excludes older results", () => {
    const bundle: LifeBundle = {
      goals: [
        {
          id: "g1",
          state: "active",
          encrypted_dek: "d",
          encrypted_content: "c",
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      memory: [],
      actions: [
        {
          id: "a1",
          goal_id: "g1",
          state: "accepted",
          review_at: "2026-09-18T12:00:00.000Z",
          period_start: "2026-09-14T12:00:00.000Z",
          encrypted_dek: "d",
          encrypted_content: "c",
          created_at: "2026-09-14T12:00:00.000Z",
          updated_at: "2026-09-14T12:00:00.000Z",
        },
      ],
      feedback: [
        {
          id: "f-old",
          action_id: "a1",
          outcome_kind: "tried_helped",
          encrypted_dek: "d",
          encrypted_content: "c",
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "f-new",
          action_id: "a1",
          outcome_kind: "tried_no_effect",
          encrypted_dek: "d",
          encrypted_content: "c",
          created_at: "2026-09-17T18:00:00.000Z",
          updated_at: "2026-09-17T18:00:00.000Z",
        },
      ],
      due_action_ids: ["a1"],
    };
    const review = buildWeeklyReview({
      now: new Date("2026-09-19T12:00:00.000Z"),
      timeZone: "UTC",
      entries: [
        { id: "e1", timestamp: "2026-09-17T08:00:00.000Z", entry_type: "THOUGHT", mood_score: 3 },
        { id: "e2", timestamp: "2026-09-18T08:00:00.000Z", entry_type: "THOUGHT", mood_score: 8 },
      ],
      bundle,
      actionPlain: { a1: { proposal: "Lights out at 23:00" } },
      feedbackPlain: {
        "f-new": { what_changed: "still waking early", observed_on: "2026-09-17" },
        "f-old": { what_changed: "ancient", observed_on: "2026-08-01" },
      },
    });
    assert.equal(review.current.feedback.length, 1);
    assert.equal(review.current.feedback[0].id, "f-new");
    assert.equal(review.current.feedback[0].recorded_at?.startsWith("2026-09-17"), true);
    assert.equal(review.current.feedback[0].observed_on, "2026-09-17");
    assert.equal(review.current.actions[0].proposal, "Lights out at 23:00");
    assert.ok(review.current.notes.includes("older_feedback_excluded"));
    assert.equal(review.comparison.helped_is_not_proof, true);
    const mood = review.current.metrics.find((m) => m.key === "mood_score");
    assert.equal(mood?.n, 2);
    assert.equal(mood?.min, 3);
    assert.equal(mood?.max, 8);
    assert.ok(review.sources.entry_ids.includes("e1"));
    assert.ok(review.sources.feedback_ids.includes("f-new"));
    assert.equal(review.sources.feedback_ids.includes("f-old"), false);
  });

  it("does not treat a missing previous-week metric as zero", () => {
    const review = buildWeeklyReview({
      now: new Date("2026-09-19T12:00:00.000Z"),
      timeZone: "UTC",
      entries: [{ id: "e1", timestamp: "2026-09-18T08:00:00.000Z", entry_type: "SLEEP", sleep_hours: 7 }],
      bundle: emptyBundle(),
    });
    const delta = review.comparison.metric_deltas.find((d) => d.key === "sleep_hours");
    assert.equal(delta?.previous_n, 0);
    assert.equal(delta?.note, "missing_is_not_zero");
    assert.equal(delta?.mean_delta, undefined);
  });
});
