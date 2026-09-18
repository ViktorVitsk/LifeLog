import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarDayKey, entryCalendarDay, yesterdayEvening } from "./dates.ts";

describe("B3 calendar days", () => {
  it("uses the account zone, not UTC", () => {
    const instant = new Date("2026-09-18T22:00:00.000Z");
    assert.equal(calendarDayKey(instant, "Europe/Moscow"), "2026-09-19");
    assert.equal(calendarDayKey(instant, "UTC"), "2026-09-18");
  });

  it("assigns sleep to the wake day", () => {
    const wake = "2026-09-19T04:00:00.000Z";
    assert.equal(entryCalendarDay(wake, "SLEEP", "Europe/Moscow"), "2026-09-19");
    assert.equal(calendarDayKey("2026-09-18T20:00:00.000Z", "Europe/Moscow"), "2026-09-18");
  });

  it("binds yesterday evening to 20:00 yesterday, not now", () => {
    const now = new Date("2026-09-19T10:30:00.000Z");
    const event = yesterdayEvening(now, "Europe/Moscow");
    assert.equal(calendarDayKey(event, "Europe/Moscow"), "2026-09-18");
    assert.notEqual(event.toISOString(), now.toISOString());
  });
});
