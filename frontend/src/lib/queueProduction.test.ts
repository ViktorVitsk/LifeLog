import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runProductionQueueIdb, runQueueIdbRace } from "./queueIdbHarness.ts";

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
});
