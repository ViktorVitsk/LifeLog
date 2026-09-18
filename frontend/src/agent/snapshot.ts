import type { Habit, Skill } from "../lib/api";
import type { MergedEntry } from "../hooks/useEntries";
import type { AppLocale } from "../i18n/locale";
import { STRINGS } from "../i18n/strings";
import { getAccountTimeZone, isSameLocalDay, localDayKey, startOfLocalDay } from "../lib/dates";

export function buildTodaySnapshot(args: {
  entries: MergedEntry[];
  skills: Skill[];
  habits: Habit[];
  locale?: AppLocale;
}) {
  const t = STRINGS[args.locale ?? "ru"];
  const day = localDayKey();
  const start = startOfLocalDay();
  const today = args.entries.filter((e) =>
    isSameLocalDay(e.timestamp, day, e.event_timezone || getAccountTimeZone()),
  );

  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;

  const mood = avg(today.map((e) => e.mood_score).filter((n): n is number => typeof n === "number"));
  const energy = avg(
    today.map((e) => e.energy_score).filter((n): n is number => typeof n === "number"),
  );
  const anxiety = avg(
    today.map((e) => e.anxiety_score).filter((n): n is number => typeof n === "number"),
  );

  const types = new Set(today.map((e) => e.entry_type));
  const sleep = [...args.entries]
    .filter((e) => e.entry_type === "SLEEP")
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];

  const lastNightSleep =
    sleep && new Date(sleep.timestamp) >= new Date(start.getTime() - 18 * 3600_000) ? sleep : null;

  const activeHabits = args.habits.filter((h) => h.is_active);
  const habitsToday = activeHabits.map((h) => {
    const logs = today.filter((e) => e.entry_type === "HABIT_LOG" && e.habit_id === h.id);
    const done = logs.some((e) => e.habit_completed === true);
    return { id: h.id, name: h.name, logged: logs.length > 0, completed: done };
  });

  const gaps: string[] = [];
  if (!types.has("DAILY_CHECKIN")) gaps.push(t.gapCheckin);
  if (!lastNightSleep && !types.has("SLEEP")) gaps.push(t.gapSleep);
  for (const h of habitsToday) {
    if (!h.logged) gaps.push(`${t.gapHabit}: ${h.name}`);
  }

  return {
    ui_language: args.locale ?? "ru",
    reply_in: (args.locale ?? "ru") === "ru" ? "Russian" : "English",
    local_day: day,
    counts: {
      today: today.length,
      by_type: Object.fromEntries(
        [...types].map((typ) => [typ, today.filter((e) => e.entry_type === typ).length]),
      ),
    },
    averages: { mood, energy, anxiety },
    sleep: lastNightSleep
      ? {
          hours: lastNightSleep.sleep_hours,
          quality: lastNightSleep.sleep_quality,
          timestamp: lastNightSleep.timestamp,
        }
      : null,
    skills: args.skills
      .filter((s) => s.is_active)
      .map((s) => ({ id: s.id, name: s.name })),
    habits: habitsToday,
    gaps,
  };
}
