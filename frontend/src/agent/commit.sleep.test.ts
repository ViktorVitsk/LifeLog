import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localDayKey, setAccountTimeZone, sleepEventTimestamp } from "../lib/dates.ts";

describe("sleep commit timestamp", () => {
  it("turns a form wake date+time into the saved event timestamp", () => {
    setAccountTimeZone("Europe/Moscow");
    const fromForm = sleepEventTimestamp({ wakeDate: "2026-09-19", wakeTime: "07:30", timeZone: "Europe/Moscow" });
    const fromProposal = sleepEventTimestamp({
      wakeTime: "07:30",
      wakeDate: localDayKey(new Date("2026-09-19T10:00:00.000Z")),
      timeZone: "Europe/Moscow",
    });
    assert.ok(fromForm);
    assert.equal(fromForm, "2026-09-19T04:30:00.000Z");
    assert.ok(fromProposal);
    assert.match(fromProposal, /T/);
  });
});
