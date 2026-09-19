import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LifeBundle } from "./api.ts";
import { collectLifePages } from "./lifePaging.ts";

function page(values: Partial<LifeBundle>): LifeBundle {
  return {
    goals: [],
    memory: [],
    actions: [],
    feedback: [],
    due_action_ids: [],
    ...values,
  };
}

describe("life bundle paging", () => {
  it("merges every kind and deduplicates due action ids", async () => {
    const offsets: number[] = [];
    const pages = [
      page({
        goals: [{ id: "g1" }] as LifeBundle["goals"],
        actions: [{ id: "a1" }] as LifeBundle["actions"],
        due_action_ids: ["a1"],
        next_offset: 1,
      }),
      page({
        goals: [{ id: "g2" }] as LifeBundle["goals"],
        memory: [{ id: "m1" }] as LifeBundle["memory"],
        due_action_ids: ["a1"],
        next_offset: null,
      }),
    ];

    const result = await collectLifePages(async (offset) => {
      offsets.push(offset);
      return pages[offset]!;
    }, 1);

    assert.deepEqual(offsets, [0, 1]);
    assert.deepEqual(result.goals.map((row) => row.id), ["g1", "g2"]);
    assert.deepEqual(result.memory.map((row) => row.id), ["m1"]);
    assert.deepEqual(result.actions.map((row) => row.id), ["a1"]);
    assert.deepEqual(result.due_action_ids, ["a1"]);
  });
});
