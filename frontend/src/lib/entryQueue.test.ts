import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { db, enqueueEntry, markSynced } from "../db/offlineQueue.ts";
import { getEntry } from "../db/outbox.ts";
import { resetTestDb } from "../test/resetDb.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";

describe("entry queue local revision", () => {
  afterEach(async () => {
    await resetTestDb();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("does not ack rev1 when the local row is already rev2", async () => {
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
    assert.equal((await getEntry(db, "e1"))?.local_rev, 2);
    await markSynced(["e1"], { sentRevs: { e1: 1 }, versions: { e1: 8 }, owner: "user-a" });
    const row = await getEntry(db, "e1");
    assert.equal(row?.status, "pending");
    assert.equal(row?.encrypted_content, "B");
    assert.equal(row?.version, 8);
    await markSynced(["e1"], { sentRevs: { e1: 2 }, versions: { e1: 9 }, owner: "user-a" });
    assert.equal((await getEntry(db, "e1"))?.status, "synced");
    assert.equal((await getEntry(db, "e1"))?.version, 9);
  });

  it("keeps payload B and moves version 7 -> 8 after a stale success", async () => {
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
    const { claimPendingEntries, applyEntryResult } = await import("../db/offlineQueue.ts");
    const sent = await claimPendingEntries(10, "user-a");
    await enqueueEntry({ ...payload, encrypted_content: "B" });
    await applyEntryResult(sent[0], { status: "updated", version: 8 });
    const row = await getEntry(db, "e2");
    assert.equal(row?.status, "pending");
    assert.equal(row?.encrypted_content, "B");
    assert.equal(row?.version, 8);
    assert.equal(row?.local_rev, 2);
  });

  it("does not mark a newer edit rejected when the old send fails", async () => {
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
    assert.equal((await getEntry(db, "e3"))?.status, "pending");
    assert.equal((await getEntry(db, "e3"))?.encrypted_content, "B");

    const sent2 = await claimPendingEntries(10, "user-a");
    await markPendingDelete(["e3"]);
    await applyEntryResult(sent2[0], { status: "updated", version: 2 });
    assert.equal((await getEntry(db, "e3"))?.status, "pending_delete");
    assert.equal((await getEntry(db, "e3"))?.version, 2);
  });
});
