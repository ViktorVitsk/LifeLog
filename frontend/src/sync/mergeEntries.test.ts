import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeEntryStreams } from "./mergeEntries.ts";

describe("B1 merge streams", () => {
  it("keeps a rejected local row over the server copy", () => {
    const merged = mergeEntryStreams(
      [{ id: "a", owner_user_id: "u1", status: "rejected" }],
      [{ id: "a" }],
      "u1",
    );
    assert.equal(merged[0]?.source, "rejected");
  });

  it("uses the server copy when local is synced", () => {
    const merged = mergeEntryStreams(
      [{ id: "a", owner_user_id: "u1", status: "synced" }],
      [{ id: "a" }],
      "u1",
    );
    assert.equal(merged[0]?.source, "server");
  });

  it("ignores another account's local rows", () => {
    const merged = mergeEntryStreams(
      [{ id: "a", owner_user_id: "u2", status: "pending" }],
      [{ id: "a" }],
      "u1",
    );
    assert.equal(merged[0]?.source, "server");
  });

  it("hides a pending_delete tombstone even if the server still has the row", () => {
    const merged = mergeEntryStreams(
      [{ id: "a", owner_user_id: "u1", status: "pending_delete" }],
      [{ id: "a" }],
      "u1",
    );
    assert.equal(merged.length, 0);
  });
});
