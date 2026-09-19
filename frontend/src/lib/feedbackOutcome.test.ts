import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionPatchForDecision,
  assertOutcomeAndDecision,
  buildFeedbackPlain,
  outcomeSourceOf,
  triedFromOutcome,
} from "./feedbackOutcome.ts";

describe("feedback outcome vs decision", () => {
  it("does not infer helped from complete or stop", () => {
    const complete = actionPatchForDecision("complete", "accepted");
    const stop = actionPatchForDecision("stop", "accepted");
    const cont = actionPatchForDecision("continue", "accepted");
    assert.equal(complete.state, "completed");
    assert.equal(stop.state, "stopped");
    assert.equal(cont.state, "accepted");
    assert.equal(triedFromOutcome("tried_no_effect"), true);
    assert.equal(triedFromOutcome("not_tried"), false);
    assert.equal(triedFromOutcome("unevaluated"), true);
    assert.equal(triedFromOutcome("not_suitable"), true);
  });

  it("keeps an explicit user outcome in the stored plaintext", () => {
    const plain = buildFeedbackPlain({
      outcome: "tried_no_effect",
      decision: "complete",
      what_changed: "свет гас не раньше 00:20",
      difficulty: "переписка",
      side_effects: "",
      observed_on: "2026-09-19",
      recorded_at: "2026-09-19T12:00:00.000Z",
      action_id: "a1",
      action_version: 3,
    });
    assert.equal(plain.outcome_kind, "tried_no_effect");
    assert.equal(plain.outcome_source, "user");
    assert.equal(plain.decision, "complete");
    assert.equal(plain.tried, true);
    assert.equal(outcomeSourceOf(plain), "user");
    assert.equal(outcomeSourceOf({ outcome_kind: "tried_helped" }), "unknown");
  });

  it("rejects a missing explicit choice", () => {
    assert.throws(() => assertOutcomeAndDecision("", "continue"), /outcome_required/);
    assert.throws(() => assertOutcomeAndDecision("tried_helped", "maybe"), /decision_required/);
  });
});
