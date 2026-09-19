import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approximateYesterdayEvening,
  calendarDayKey,
  entryCalendarDay,
  sleepEventTimestamp,
  startOfLocalDay,
  startOfLocalDayBack,
  wakeTimestamp,
  yesterdayEvening,
} from "./dates.ts";

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
    assert.equal(approximateYesterdayEvening(now, "Europe/Moscow").approximate, true);
  });

  it("writes sleep timestamp as wake in the account zone, even across midnight", () => {
    const ts = wakeTimestamp("2026-09-19", "07:30", "Europe/Moscow");
    assert.equal(calendarDayKey(ts, "Europe/Moscow"), "2026-09-19");
    assert.equal(sleepEventTimestamp({ wakeDate: "2026-09-19", wakeTime: "07:30", timeZone: "Europe/Moscow" }), ts);
    assert.equal(
      sleepEventTimestamp({ wakeTime: "2026-09-19T04:30:00.000Z" }),
      "2026-09-19T04:30:00.000Z",
    );
  });

  it("shifts calendar weeks across DST instead of subtracting 6*24h", () => {
    const spring = new Date("2026-03-30T12:00:00.000Z");
    const weekStart = startOfLocalDayBack(spring, 6, "Europe/Berlin");
    assert.equal(calendarDayKey(weekStart, "Europe/Berlin"), "2026-03-24");
    const naive = new Date(startOfLocalDay(spring, "Europe/Berlin").getTime() - 6 * 24 * 3600_000);
    assert.notEqual(calendarDayKey(naive, "Europe/Berlin"), "2026-03-24");
  });
});
