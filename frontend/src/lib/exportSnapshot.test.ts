import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeExportEntries, mergeExportLife } from "./exportMerge.ts";
import type { PendingEntry, PendingLife } from "../db/offlineQueue.ts";

describe("full export merge", () => {
  it("does not resurrect a tombstoned entry from an stale local cache", () => {
    const local = {
      id: "dead",
      timestamp: "t",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "c",
      status: "synced",
      queued_at: 1,
      attempts: 0,
      owner_user_id: "u1",
    } as PendingEntry;
    const merged = mergeExportEntries(
      [{ id: "dead", timestamp: "t", entry_type: "THOUGHT", encrypted_dek: "d", encrypted_content: "c", created_at: "t", synced_from_offline: true }],
      [local],
      "u1",
      ["dead"],
    );
    assert.equal(merged.length, 0);
  });

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

  it("keeps both conflict variants and drops tombstoned cache rows", () => {
    const local: PendingLife[] = [
      {
        id: "g1",
        kind: "goal",
        payload: { state: "active", encrypted_content: "local" },
        status: "conflict",
        owner_user_id: "u1",
        queued_at: 1,
        server_snapshot: { state: "active", encrypted_content: "server" },
      },
      {
        id: "g2",
        kind: "goal",
        payload: { state: "active" },
        status: "synced",
        owner_user_id: "u1",
        queued_at: 1,
      },
    ];
    const life = mergeExportLife(
      { goals: [{ id: "g2" } as never], memory: [], actions: [], feedback: [], due_action_ids: [] },
      local,
      "u1",
      ["g2"],
    );
    assert.equal(life.goal.length, 1);
    assert.equal(life.goal[0].id, "g1");
    assert.equal(life.goal[0].sync_status, "conflict");
    assert.equal((life.goal[0].server_variant as { encrypted_content?: string })?.encrypted_content, "server");
    assert.equal(life.goal[0].conflict_note, "local_and_server_kept");
  });
});
