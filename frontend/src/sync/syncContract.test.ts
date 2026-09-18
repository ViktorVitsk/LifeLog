import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planQueueUpdates } from "./syncContract.ts";

describe("B1 sync contract client", () => {
  it("marks only created and duplicate ids as synced", () => {
    const plan = planQueueUpdates(
      {
        results: [
          { id: "a", status: "created" },
          { id: "b", status: "duplicate" },
          { id: "c", status: "conflict", reason: "content_mismatch" },
          { id: "d", status: "rejected", reason: "unknown_skill" },
        ],
      },
      ["a", "b", "c", "d"],
    );
    assert.deepEqual(plan.markSynced, ["a", "b"]);
    assert.deepEqual(
      plan.markRejected.map((r) => r.id),
      ["c", "d"],
    );
    assert.deepEqual(plan.leavePending, []);
    assert.deepEqual(plan.ackDelete, []);
  });

  it("does not mark the whole sent batch from a partial saved list", () => {
    const plan = planQueueUpdates({ saved: ["a"] }, ["a", "b"]);
    assert.deepEqual(plan.markSynced, ["a"]);
    assert.deepEqual(plan.leavePending, ["b"]);
    assert.deepEqual(plan.markRejected, []);
  });

  it("ignores ids the client did not send", () => {
    const plan = planQueueUpdates(
      { results: [{ id: "evil", status: "created" }, { id: "a", status: "created" }] },
      ["a"],
    );
    assert.deepEqual(plan.markSynced, ["a"]);
  });

  it("leaves unknown statuses pending instead of synced", () => {
    const plan = planQueueUpdates({ results: [{ id: "a", status: "wat" }] }, ["a"]);
    assert.deepEqual(plan.markSynced, []);
    assert.deepEqual(plan.leavePending, ["a"]);
  });
});

describe("B2 delete / in-flight undo", () => {
  it("acks a confirmed delete and does not mark it synced", () => {
    const plan = planQueueUpdates(
      { results: [{ id: "a", status: "deleted" }] },
      ["a"],
      { deletingIds: ["a"] },
    );
    assert.deepEqual(plan.ackDelete, ["a"]);
    assert.deepEqual(plan.markSynced, []);
  });

  it("treats delete-of-missing as duplicate ack", () => {
    const plan = planQueueUpdates(
      { results: [{ id: "a", status: "duplicate" }] },
      ["a"],
      { deletingIds: ["a"] },
    );
    assert.deepEqual(plan.ackDelete, ["a"]);
  });

  it("does not mark created synced if the row is already a tombstone", () => {
    const plan = planQueueUpdates(
      { results: [{ id: "a", status: "created" }] },
      ["a"],
      { hideCreatedIfTombstone: ["a"] },
    );
    assert.deepEqual(plan.markSynced, []);
    assert.deepEqual(plan.leavePending, ["a"]);
  });
});
