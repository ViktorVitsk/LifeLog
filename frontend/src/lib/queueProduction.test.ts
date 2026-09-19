import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runProductionQueueIdb, runQueueIdbRace } from "./queueIdbHarness.ts";
import { runDexieV6Migration } from "./lifeOpIdbHarness.ts";

describe("production queue on isolated IndexedDB", () => {
  it("keeps the helper race and calls production enqueue/claim/ack on a throwaway db", async (t) => {
    if (typeof indexedDB === "undefined") {
      t.skip("indexedDB is a browser check; node keeps TestQueue coverage");
      return;
    }
    const helper = await runQueueIdbRace();
    assert.equal(helper.ok, true, helper.notes.join("; "));
    const prod = await runProductionQueueIdb();
    assert.equal(prod.ok, true, prod.notes.join("; "));
  });

  it("upgrades a real v6 IndexedDB and keeps both legacy operations deliverable", async (t) => {
    if (typeof indexedDB === "undefined") {
      t.skip("Dexie v6→v7 needs a real IndexedDB, not an in-memory object transform");
      return;
    }
    const mig = await runDexieV6Migration();
    assert.equal(mig.ok, true, mig.notes.join("; "));
  });
});
