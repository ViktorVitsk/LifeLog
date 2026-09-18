import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleMemoryProfile } from "./lifeProfile.ts";

describe("C memory profile", () => {
  it("assembles only accepted items and stays rebuildable", () => {
    const profile = assembleMemoryProfile([
      { state: "proposed", kind: "preference", statement: "ignore" },
      { state: "accepted", kind: "preference", statement: "I prefer evening logs" },
      { state: "disputed", kind: "hypothesis", statement: "no" },
    ]);
    assert.deepEqual(profile, [{ kind: "preference", statement: "I prefer evening logs" }]);
  });
});
