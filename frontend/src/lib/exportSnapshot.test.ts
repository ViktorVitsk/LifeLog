import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeExportEntries, mergeExportLife } from "./exportMerge.ts";
import type { PendingEntry, PendingLife } from "../db/offlineQueue.ts";

describe("full export merge", () => {
  it("keeps a local synced copy that is missing from a server page", () => {
    const local = {
      id: "e1",
      timestamp: "t",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "c",
      status: "synced",
      queued_at: 1,
      attempts: 0,
      owner_user_id: "u1",
    } as PendingEntry;
    const merged = mergeExportEntries([], [local], "u1");
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "e1");
    assert.equal(merged[0].sync_status, "synced");
  });

  it("does not duplicate a pending overlay", () => {
    const server = [
      {
        id: "e1",
        timestamp: "t",
        entry_type: "THOUGHT",
        encrypted_dek: "old",
        encrypted_content: "old",
        created_at: "t",
        synced_from_offline: true,
      },
    ];
    const local = {
      id: "e1",
      timestamp: "t",
      entry_type: "THOUGHT",
      encrypted_dek: "new",
      encrypted_content: "new",
      status: "pending",
      queued_at: 2,
      attempts: 0,
      owner_user_id: "u1",
    } as PendingEntry;
    const merged = mergeExportEntries(server, [local], "u1");
    assert.equal(merged.length, 1);
    assert.equal(merged[0].sync_status, "pending");
  });

  it("lists pending_delete and rejected life rows explicitly", () => {
    const local: PendingLife[] = [
      {
        id: "g1",
        kind: "goal",
        payload: { state: "active" },
        status: "pending",
        owner_user_id: "u1",
        queued_at: 1,
      },
      {
        id: "m1",
        kind: "memory",
        payload: { state: "proposed" },
        status: "rejected",
        owner_user_id: "u1",
        queued_at: 1,
        last_error: "invalid_state",
      },
    ];
    const life = mergeExportLife(undefined, local, "u1");
    assert.equal(life.goal[0].sync_status, "pending");
    assert.equal(life.memory[0].sync_status, "rejected");
  });
});
