import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { claimPendingEntries, db, enqueueEntry, toEntryPayload } from "./offlineQueue.ts";
import { getEntry } from "./outbox.ts";
import { resetTestDb } from "../test/resetDb.ts";
import { setCurrentUserId, setEncryptAllowed } from "../lib/accountScope.ts";

describe("toEntryPayload goal_id omission", () => {
  afterEach(async () => {
    await resetTestDb();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("keeps goal_id on the stored row and omits it from the sync payload", async () => {
    setCurrentUserId("user-a");
    setEncryptAllowed(true);
    await enqueueEntry({
      id: "e-goal",
      timestamp: "2026-09-19T00:00:00.000Z",
      entry_type: "THOUGHT",
      goal_id: "g1",
      encrypted_dek: "d",
      encrypted_content: "c",
      tags: [],
    });
    const stored = await getEntry(db, "e-goal");
    assert.equal(stored?.goal_id, "g1");
    assert.equal(toEntryPayload(stored!).goal_id, undefined);
    const sent = await claimPendingEntries(10, "user-a");
    assert.equal(sent[0]?.payload.goal_id, undefined);
  });
});
