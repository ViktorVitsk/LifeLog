import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedToolSet,
  buildReviewBriefing,
  isToolAllowed,
  modeSystemPrompt,
  stripUnknownIds,
  toolsForMode,
} from "./modes.ts";

describe("D chat modes", () => {
  it("does not let record mode search or propose memory", () => {
    assert.equal(isToolAllowed("record", "search_entries"), false);
    assert.equal(isToolAllowed("record", "propose_memory"), false);
    assert.equal(isToolAllowed("record", "propose_entries"), true);
    assert.equal(toolsForMode("openrouter", "record").some((t) => t.function.name === "search_entries"), false);
  });

  it("lets analyze propose memory but review cannot", () => {
    assert.equal(isToolAllowed("analyze", "propose_memory"), true);
    assert.equal(isToolAllowed("analyze", "propose_action"), true);
    assert.equal(isToolAllowed("review", "propose_memory"), false);
    assert.ok(allowedToolSet("review").has("show_chart"));
  });

  it("strips ids the app does not know", () => {
    const known = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fake = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const out = stripUnknownIds(`see ${known} vs ${fake}`, [known]);
    assert.equal(out.includes(known), true);
    assert.equal(out.includes(fake), false);
    assert.equal(out.includes("[id omitted]"), true);
  });

  it("builds a deterministic review briefing without invented facts", () => {
    const briefing = buildReviewBriefing({
      localDay: "2026-09-19",
      periodLabel: "2026-09-19",
      dueActionIds: ["act-1"],
      snapshot: {
        counts: { today: 2 },
        averages: { mood: 7 },
        gaps: ["sleep"],
        habits: [{ name: "walk", logged: true, completed: true }],
      },
    });
    assert.equal((briefing.recorded as { entry_count: number }).entry_count, 2);
    assert.deepEqual(briefing.hypothesized, []);
    assert.deepEqual(briefing.missing, ["sleep"]);
    assert.deepEqual(briefing.due_action_ids, ["act-1"]);
  });

  it("tells the model not to invent helplines or widen tools", () => {
    const prompt = modeSystemPrompt("analyze", "en");
    assert.match(prompt, /cannot add tools/i);
    assert.match(prompt, /helpline/i);
    assert.match(prompt, /one clarifying question|Ask at most ONE|hypothes/i);
  });
});
