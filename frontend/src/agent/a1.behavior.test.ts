import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeProposal } from "./normalizeProposal.ts";
import { appConfirmation, stripModelConfirmation } from "./confirmation.ts";
import {
  filterByWindow,
  remainingDecryptBudget,
  resolveContextEnvelope,
  type ContextBudget,
} from "./contextEnvelope.ts";
import { isModelWriteTool, modelWriteBlockedResult } from "./persistPolicy.ts";
import {
  parseOptionalScore,
  parseHabitCompleted,
  validateProposalForSave,
} from "./proposalValidation.ts";
import { parseJsonObject, validateToolArgs } from "./toolArgs.ts";
import { DEFAULT_LLM_SETTINGS } from "./types.ts";

describe("A1 proposal vs persist", () => {
  it("ignores model user_confirmed and auto_commit keys", () => {
    const stripped = stripModelConfirmation({
      entry_type: "THOUGHT",
      user_confirmed: true,
      auto_commit: true,
      confirmation_event_id: "forged",
    });
    assert.equal("user_confirmed" in stripped, false);
    assert.equal("auto_commit" in stripped, false);

    const p = normalizeProposal(
      {
        entry_type: "THOUGHT",
        content: "heavy day",
        user_confirmed: true,
        auto_commit: true,
        provenance: "user_stated",
      },
      [],
      [],
    );
    assert.ok(p);
    assert.equal(p.auto_commit, false);
    assert.equal(p.mood_score, null);
  });

  it("does not invent a mood for a hard day with no number", () => {
    const p = normalizeProposal(
      { entry_type: "DAILY_CHECKIN", notes: "Был тяжёлый день", provenance: "agent_extracted" },
      [],
      [],
    );
    assert.ok(p);
    assert.equal(p.mood_score, null);
    assert.equal(p.energy_score, null);
  });

  it("rejects out-of-range scores instead of clamping", () => {
    assert.equal(parseOptionalScore(0, "mood_score").value, null);
    assert.equal(parseOptionalScore(0, "mood_score").issue?.message, "out_of_range");
    assert.equal(parseOptionalScore(99, "mood_score").value, null);
    assert.equal(parseOptionalScore(7, "mood_score").value, 7);
    const p = normalizeProposal(
      { entry_type: "DAILY_CHECKIN", mood_score: 0, notes: "zero" },
      [],
      [],
    );
    assert.ok(p);
    assert.equal(p.mood_score, null);
    assert.ok((p.issues ?? []).some((i) => i.field === "mood_score"));
  });

  it("does not treat missing habit_completed as done", () => {
    assert.equal(parseHabitCompleted(undefined).value, null);
    const p = normalizeProposal(
      { entry_type: "HABIT_LOG", habit_name: "run", provenance: "agent_extracted" },
      [],
      [],
    );
    assert.ok(p);
    assert.equal(p.habit_completed, null);
    const issues = validateProposalForSave(p);
    assert.ok(issues.some((i) => i.field === "habit_completed"));
  });

  it("blocks write tools without executing them", () => {
    for (const name of ["commit_entries", "create_habit", "create_skill", "update_habit"]) {
      assert.equal(isModelWriteTool(name), true);
      const r = modelWriteBlockedResult(name);
      assert.equal(r.error, "persist_requires_user_confirmation");
    }
  });

  it("app confirmation is separate from the source turn", () => {
    const meta = appConfirmation({
      source: "entry_card",
      source_turn_id: "user-turn-1",
      event_id: "confirm-9",
      now: new Date("2026-09-19T10:00:00.000Z"),
    });
    assert.equal(meta.user_confirmed, true);
    assert.equal(meta.source_turn_id, "user-turn-1");
    assert.equal(meta.confirmation_event_id, "confirm-9");
    assert.notEqual(meta.confirmation_event_id, meta.source_turn_id);
  });
});

describe("A1 tool arg validation", () => {
  it("rejects invalid JSON", () => {
    const r = parseJsonObject("{nope");
    assert.equal(r.ok, false);
  });

  it("rejects propose_entries without entries", () => {
    const r = validateToolArgs("propose_entries", {});
    assert.equal(r.ok, false);
  });
});

describe("A2 context envelope", () => {
  it("today and 7d_open do not allow decrypt", () => {
    const today = resolveContextEnvelope({ ...DEFAULT_LLM_SETTINGS, context_policy: "today" });
    const week = resolveContextEnvelope({ ...DEFAULT_LLM_SETTINGS, context_policy: "7d_open" });
    assert.equal(today.allowDecrypt, false);
    assert.equal(week.allowDecrypt, false);
    assert.ok(week.windowStart.getTime() < today.windowStart.getTime());
  });

  it("decrypt budget is unique per run, not per call", () => {
    const envelope = resolveContextEnvelope({
      ...DEFAULT_LLM_SETTINGS,
      context_policy: "decrypt_n",
      decrypt_n: 2,
    });
    const budget: ContextBudget = {
      envelope,
      decryptedEntryIds: new Set(["a"]),
      decryptedKeys: new Set(["entry:a"]),
      audit: [],
      provider: "openrouter",
    };
    assert.equal(remainingDecryptBudget(budget), 1);
    budget.decryptedKeys.add("entry:b");
    budget.decryptedEntryIds.add("b");
    assert.equal(remainingDecryptBudget(budget), 0);
  });

  it("search window does not include dates outside the envelope", () => {
    const envelope = resolveContextEnvelope({ ...DEFAULT_LLM_SETTINGS, context_policy: "today" });
    const old = { timestamp: new Date(envelope.windowStart.getTime() - 3 * 86400000).toISOString() };
    const now = { timestamp: envelope.windowEnd.toISOString() };
    const rows = filterByWindow([old, now], envelope.windowStart, envelope.windowEnd);
    assert.equal(rows.includes(old), false);
    assert.equal(rows.includes(now), true);
  });
});
