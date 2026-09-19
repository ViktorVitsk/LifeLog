/** Account-local calendar days. Instants stay UTC; days use an IANA zone. */

let accountTimeZone = "UTC";

export function setAccountTimeZone(timeZone: string): void {
  accountTimeZone = timeZone || "UTC";
}

export function getAccountTimeZone(): string {
  return accountTimeZone;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function calendarDayKey(input: Date | string = new Date(), timeZone = getAccountTimeZone()): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/** Local calendar day YYYY-MM-DD in the account timezone. */
export function localDayKey(d: Date = new Date()): string {
  return calendarDayKey(d, getAccountTimeZone());
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const lookup = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const hour = Number(lookup.hour) % 24;
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    hour,
    Number(lookup.minute),
    Number(lookup.second),
  );
  return asUtc - instant.getTime();
}

export function zonedWallTimeToUtc(
  day: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [year, month, date] = day.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, date, hour, minute, 0);
  let instant = new Date(utcGuess);
  instant = new Date(utcGuess - tzOffsetMs(instant, timeZone));
  instant = new Date(utcGuess - tzOffsetMs(instant, timeZone));
  return instant;
}

export function startOfLocalDay(d: Date = new Date(), timeZone = getAccountTimeZone()): Date {
  const day = calendarDayKey(d, timeZone);
  return zonedWallTimeToUtc(day, 0, 0, timeZone);
}

export function isSameLocalDay(
  iso: string,
  day = localDayKey(),
  timeZone = getAccountTimeZone(),
): boolean {
  return calendarDayKey(iso, timeZone) === day;
}

/** Sleep belongs to the local day of wake (`timestamp`). Use the event zone so trips do not rewrite old days. */
export function entryCalendarDay(
  timestamp: string,
  entryType: string,
  timeZone = getAccountTimeZone(),
): string {
  void entryType;
  return calendarDayKey(timestamp, timeZone);
}

function shiftCivilDay(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Approximate 20:00 yesterday in the account zone — not an exact event timestamp. */
export function yesterdayEvening(now = new Date(), timeZone = getAccountTimeZone()): Date {
  const today = calendarDayKey(now, timeZone);
  return zonedWallTimeToUtc(shiftCivilDay(today, -1), 20, 0, timeZone);
}

export function approximateYesterdayEvening(
  now = new Date(),
  timeZone = getAccountTimeZone(),
): { at: Date; approximate: true } {
  return { at: yesterdayEvening(now, timeZone), approximate: true };
}

/** Wake wall-clock on the wake calendar day becomes the SLEEP event timestamp. */
export function wakeTimestamp(
  wakeDay: string,
  wakeTime: string,
  timeZone = getAccountTimeZone(),
): string {
  const match = wakeTime.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new Error("invalid_wake_time");
  return zonedWallTimeToUtc(wakeDay, Number(match[1]), Number(match[2]), timeZone).toISOString();
}

export function sleepEventTimestamp(args: {
  wakeDate?: string;
  wakeTime?: string;
  fallback?: string;
  timeZone?: string;
}): string | undefined {
  const zone = args.timeZone ?? getAccountTimeZone();
  if (args.wakeTime && args.wakeTime.includes("T")) return args.wakeTime;
  if (args.wakeTime && args.wakeDate) {
    try {
      return wakeTimestamp(args.wakeDate, args.wakeTime, zone);
    } catch {
      return args.fallback;
    }
  }
  return args.fallback;
}

export const COMMON_TIMEZONES = [
  "UTC",
  "Europe/Moscow",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Almaty",
] as const;
