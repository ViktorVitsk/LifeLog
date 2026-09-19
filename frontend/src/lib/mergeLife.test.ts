import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDueActionIds, mergeLifeBundle } from "./mergeLife.ts";
import type { PendingLife } from "../db/offlineQueue.ts";

describe("merge life queue", () => {
  it("shows a pending goal before the server has it", () => {
    const row: PendingLife = {
      id: "g1",
      kind: "goal",
      payload: { state: "active", encrypted_dek: "d", encrypted_content: "c" },
      status: "pending",
      owner_user_id: "u1",
      queued_at: 1,
    };
    const merged = mergeLifeBundle(undefined, [row], "u1");
    assert.equal(merged.goals.length, 1);
    assert.equal(merged.goals[0].id, "g1");
  });

  it("keeps a rejected row instead of dropping it", () => {
    const row: PendingLife = {
      id: "m1",
      kind: "memory",
      payload: { state: "proposed", kind: "preference", encrypted_dek: "d", encrypted_content: "c" },
      status: "rejected",
      owner_user_id: "u1",
      queued_at: 1,
      last_error: "invalid_state",
    };
    const merged = mergeLifeBundle(
      { goals: [], memory: [], actions: [], feedback: [], due_action_ids: [] },
      [row],
      "u1",
    );
    assert.equal(merged.memory.length, 1);
    assert.equal(merged.memory[0].id, "m1");
  });

  it("keeps a local synced goal when the server bundle is missing", () => {
    const row: PendingLife = {
      id: "g-sync",
      kind: "goal",
      payload: { state: "active", encrypted_dek: "d", encrypted_content: "c", title: "cached" },
      status: "synced",
      owner_user_id: "u1",
      queued_at: 1,
      server_version: 3,
    };
    const merged = mergeLifeBundle(undefined, [row], "u1");
    assert.equal(merged.goals.length, 1);
    assert.equal(merged.goals[0].id, "g-sync");
  });

  it("does not treat a missing server id as a delete when a cache row exists", () => {
    const cached: PendingLife = {
      id: "g-other-device",
      kind: "goal",
      payload: { state: "active", encrypted_dek: "d", encrypted_content: "c" },
      status: "synced",
      owner_user_id: "u1",
      queued_at: 1,
    };
    const server = {
      goals: [],
      memory: [],
      actions: [],
      feedback: [],
      due_action_ids: [],
    };
    const merged = mergeLifeBundle(server, [cached], "u1");
    assert.equal(merged.goals.length, 1);
    assert.equal(merged.goals[0].id, "g-other-device");
  });

  it("does not duplicate a pending overlay of a server row", () => {
    const server = {
      goals: [
        {
          id: "g1",
          state: "active",
          encrypted_dek: "old",
          encrypted_content: "old",
          created_at: "t",
          updated_at: "t",
        },
      ],
      memory: [],
      actions: [],
      feedback: [],
      due_action_ids: [],
    };
    const row: PendingLife = {
      id: "g1",
      kind: "goal",
      payload: { state: "active", encrypted_dek: "new", encrypted_content: "new" },
      status: "pending",
      owner_user_id: "u1",
      queued_at: 2,
    };
    const merged = mergeLifeBundle(server, [row], "u1");
    assert.equal(merged.goals.length, 1);
    assert.equal(merged.goals[0].encrypted_content, "new");
  });
});

describe("due actions", () => {
  it("lists accepted actions whose review_at is due", () => {
    const ids = computeDueActionIds(
      [
        { id: "a", review_at: "2020-01-01T00:00:00.000Z", state: "accepted" },
        { id: "b", review_at: "2099-01-01T00:00:00.000Z", state: "accepted" },
        { id: "c", review_at: "2020-01-01T00:00:00.000Z", state: "completed" },
      ],
      new Date("2026-09-19T12:00:00.000Z"),
    );
    assert.deepEqual(ids, ["a"]);
  });
});
