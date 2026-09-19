import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runOutboxUpgradeSuite, runV7toV8Upgrade, runV8OldTab, runV8UpgradeAbort } from "./outboxUpgradeHarness.ts";

describe("Dexie v7 to v8 outbox upgrade", () => {
  it("copies legacy rows including historical operation revisions", async () => {
    const result = await runV7toV8Upgrade();
    assert.equal(result.ok, true, result.notes.join(" | "));
  });

  it("aborts a failed upgrade and leaves a readable v7 database", async () => {
    const result = await runV8UpgradeAbort();
    assert.equal(result.ok, true, result.notes.join(" | "));
  });

  it("closes an open v7 tab on versionchange and does not leak partial v8 writes", async () => {
    const result = await runV8OldTab();
    assert.equal(result.ok, true, result.notes.join(" | "));
  });

  it("runs the combined upgrade suite", async () => {
    const result = await runOutboxUpgradeSuite();
    assert.equal(result.ok, true, result.notes.join(" | "));
  });
});
