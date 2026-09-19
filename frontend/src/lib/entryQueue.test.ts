import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { enqueueEntry, markSynced } from "../db/offlineQueue.ts";
import { installTestQueue, uninstallTestQueue } from "../db/testQueue.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";

describe("entry queue local revision", () => {
  afterEach(() => {
    uninstallTestQueue();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("does not ack rev1 when the local row is already rev2", async () => {
    const store = installTestQueue();
    setCurrentUserId("user-a");
    setEncryptAllowed(true);
    const payload = {
      id: "e1",
      timestamp: "2026-09-19T00:00:00.000Z",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "A",
    };
    await enqueueEntry(payload);
    await enqueueEntry({ ...payload, encrypted_content: "B" });
    assert.equal(store.entries.get("e1")?.local_rev, 2);
    await markSynced(["e1"], { sentRevs: { e1: 1 }, versions: { e1: 8 }, owner: "user-a" });
    const row = store.entries.get("e1");
    assert.equal(row?.status, "pending");
    assert.equal(row?.encrypted_content, "B");
    assert.equal(row?.version, 8);
    await markSynced(["e1"], { sentRevs: { e1: 2 }, versions: { e1: 9 }, owner: "user-a" });
    assert.equal(store.entries.get("e1")?.status, "synced");
    assert.equal(store.entries.get("e1")?.version, 9);
  });

  it("keeps payload B and moves version 7 -> 8 after a stale success", async () => {
    const store = installTestQueue();
    setCurrentUserId("user-a");
    setEncryptAllowed(true);
    const payload = {
      id: "e2",
      timestamp: "2026-09-19T00:00:00.000Z",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "A",
      version: 7,
    };
    await enqueueEntry(payload);
    store.entries.get("e2")!.version = 7;
    const { claimPendingEntries, applyEntryResult } = await import("../db/offlineQueue.ts");
    const sent = await claimPendingEntries(10, "user-a");
    await enqueueEntry({ ...payload, encrypted_content: "B" });
    await applyEntryResult(sent[0], { status: "updated", version: 8 });
    const row = store.entries.get("e2");
    assert.equal(row?.status, "pending");
    assert.equal(row?.encrypted_content, "B");
    assert.equal(row?.version, 8);
    assert.equal(row?.local_rev, 2);
  });

  it("does not mark a newer edit rejected when the old send fails", async () => {
    const store = installTestQueue();
    setCurrentUserId("user-a");
    setEncryptAllowed(true);
    const payload = {
      id: "e3",
      timestamp: "2026-09-19T00:00:00.000Z",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "A",
    };
    await enqueueEntry(payload);
    const { claimPendingEntries, applyEntryResult, markPendingDelete } = await import("../db/offlineQueue.ts");
    const sent = await claimPendingEntries(10, "user-a");
    await enqueueEntry({ ...payload, encrypted_content: "B" });
    await applyEntryResult(sent[0], { status: "rejected", reason: "invalid" });
    assert.equal(store.entries.get("e3")?.status, "pending");
    assert.equal(store.entries.get("e3")?.encrypted_content, "B");

    const sent2 = await claimPendingEntries(10, "user-a");
    await markPendingDelete(["e3"]);
    await applyEntryResult(sent2[0], { status: "updated", version: 2 });
    assert.equal(store.entries.get("e3")?.status, "pending_delete");
    assert.equal(store.entries.get("e3")?.version, 2);
  });
});
