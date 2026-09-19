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
    await markSynced(["e1"], { sentRevs: { e1: 1 }, versions: { e1: 1 } });
    const row = store.entries.get("e1");
    assert.equal(row?.status, "pending");
    assert.equal(row?.encrypted_content, "B");
    await markSynced(["e1"], { sentRevs: { e1: 2 }, versions: { e1: 2 } });
    assert.equal(store.entries.get("e1")?.status, "synced");
  });
});
