import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { db, enqueueEntry } from "../db/offlineQueue.ts";
import { getEntry, getLife } from "../db/outbox.ts";
import { resetTestDb } from "../test/resetDb.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";
import { api } from "./api.ts";
import { flushOutboxUnlocked } from "./flushOutbox.ts";
import { enqueueLife } from "./lifeQueue.ts";

describe("flushOutbox partial success", () => {
  afterEach(async () => {
    mock.restoreAll();
    await resetTestDb();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("does not mark earlier endpoints error or zero saved when a later endpoint throws", async () => {
    setCurrentUserId("user-a");
    setEncryptAllowed(true);
    await enqueueEntry({
      id: "e1",
      timestamp: "2026-09-19T00:00:00.000Z",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "c",
      tags: [],
    });
    await enqueueLife("goal", {
      id: "g1",
      encrypted_content: "g",
      encrypted_dek: "d",
      state: "active",
    });
    await enqueueLife("memory", {
      id: "m1",
      encrypted_content: "m",
      encrypted_dek: "d",
      state: "proposed",
    });

    mock.method(api, "syncEntries", async () => ({
      saved: ["e1"],
      errors: [],
      results: [{ id: "e1", status: "created", version: 1 }],
    }));
    mock.method(api, "syncLifeGoals", async () => ({
      saved: ["g1"],
      results: [{ id: "g1", status: "updated", version: 1 }],
    }));
    mock.method(api, "syncLifeMemory", async () => {
      throw new Error("memory endpoint failed");
    });

    const result = await flushOutboxUnlocked("token", "user-a");

    assert.equal((await getEntry(db, "e1"))?.status, "synced");
    assert.equal((await getLife(db, "g1"))?.status, "synced");
    assert.equal((await getLife(db, "m1"))?.status, "error");
    assert.equal((await getLife(db, "m1"))?.last_error, "memory endpoint failed");
    assert.equal(result.saved, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.attempted, 3);
    assert.equal(result.error, "memory endpoint failed");
  });
  it("syncs a new offline goal before the entry that references it", async () => {
    setCurrentUserId("fictional-owner");
    setEncryptAllowed(true);
    await enqueueLife("goal", { id: "goal-new", state: "active", encrypted_dek: "d", encrypted_content: "g" });
    await enqueueEntry({ id: "entry-new", goal_id: "goal-new", timestamp: new Date().toISOString(), entry_type: "GOAL_UPDATE", encrypted_dek: "d", encrypted_content: "c", tags: [] });
    const order: string[] = [];
    mock.method(api, "syncLifeGoals", async () => {
      order.push("goal");
      return { saved: ["goal-new"], results: [{ id: "goal-new", status: "created", version: 1 }] };
    });
    mock.method(api, "syncEntries", async (rows) => {
      assert.deepEqual(order, ["goal"]);
      assert.equal(rows[0].goal_id, "goal-new");
      order.push("entry");
      return { saved: ["entry-new"], errors: [], results: [{ id: "entry-new", status: "created", version: 1 }] };
    });
    assert.equal((await flushOutboxUnlocked("token", "fictional-owner")).saved, 2);
    assert.deepEqual(order, ["goal", "entry"]);
    assert.equal((await getEntry(db, "entry-new"))?.status, "synced");
  });

});
