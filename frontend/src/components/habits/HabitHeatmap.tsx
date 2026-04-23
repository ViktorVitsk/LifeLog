import { useMemo } from "react";
import type { EntryRead } from "../../lib/api";

interface Props {
  entries: EntryRead[];
  habitId: string;
  weeks?: number;
}

/**
 * GitHub-style calendar: columns = weeks (Mon→Sun rows).
 * Intensity from count of HABIT_LOG rows that day with habit_completed === true.
 */
export default function HabitHeatmap({ entries, habitId, weeks = 14 }: Props) {
  const { cells, monthLabels } = useMemo(
    () => buildGrid(entries, habitId, weeks),
    [entries, habitId, weeks],
  );

  if (!habitId) {
    return <div className="text-sm text-zinc-500">Select a habit.</div>;
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 overflow-x-auto">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-200">Completion heatmap</h3>
        <span className="text-[11px] text-zinc-500">{weeks} weeks · darker = more logs</span>
      </div>
      <div className="flex gap-3 min-w-max">
        <div className="flex flex-col justify-around text-[10px] text-zinc-500 pr-1 pt-5">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
        </div>
        <div className="flex gap-[3px]">
          {cells.map((col, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {col.map((cell, di) => (
                <div
                  key={di}
                  title={
                    cell.inFuture
                      ? `${cell.day} (future)`
                      : `${cell.day}: ${cell.count} completed`
                  }
                  className={`w-3 h-3 rounded-sm ${intensityClass(cell)}`}
                />
              ))}
              <div className="h-4 text-[9px] text-zinc-600 text-center truncate max-w-[14px]">
                {monthLabels[wi] ?? ""}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500">
        <span>Less</span>
        <span className="w-3 h-3 rounded-sm bg-zinc-800" />
        <span className="w-3 h-3 rounded-sm bg-emerald-900/50" />
        <span className="w-3 h-3 rounded-sm bg-emerald-700/60" />
        <span className="w-3 h-3 rounded-sm bg-emerald-500" />
        <span>More</span>
      </div>
    </div>
  );
}

interface Cell {
  day: string;
  count: number;
  inFuture?: boolean;
}

function sameUuid(a: unknown, b: string): boolean {
  if (a == null || !b) return false;
  const na = String(a).replace(/-/g, "").toLowerCase();
  const nb = String(b).replace(/-/g, "").toLowerCase();
  return na.length > 0 && na === nb;
}

/** Treat JSON / driver quirks: strict true or numeric 1. */
function isHabitDone(v: unknown): boolean {
  return v === true || v === 1;
}

function intensityClass(cell: Cell) {
  if (cell.inFuture) return "bg-zinc-900/25";
  if (cell.count <= 0) return "bg-zinc-800";
  if (cell.count === 1) return "bg-emerald-900/50";
  if (cell.count === 2) return "bg-emerald-700/60";
  return "bg-emerald-500";
}

function buildGrid(entries: EntryRead[], habitId: string, weeks: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const completedByDay = new Map<string, number>();
  for (const e of entries) {
    if (e.entry_type !== "HABIT_LOG") continue;
    if (!sameUuid(e.habit_id, habitId)) continue;
    if (!isHabitDone(e.habit_completed)) continue;
    const ts = new Date(e.timestamp);
    if (ts > today) continue;
    const k = dayKey(ts);
    completedByDay.set(k, (completedByDay.get(k) ?? 0) + 1);
  }

  const totalDays = weeks * 7;
  const approxStart = new Date(today);
  approxStart.setDate(approxStart.getDate() - (totalDays - 1));
  const startMonday = startOfWeekMonday(approxStart);

  const flat: Cell[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startMonday);
    d.setDate(startMonday.getDate() + i);
    const k = dayKey(d);
    const inFuture = d > today;
    flat.push({
      day: k,
      count: inFuture ? 0 : (completedByDay.get(k) ?? 0),
      inFuture,
    });
  }

  // Each column = one week, rows Mon(0) → Sun(6).
  const cells: Cell[][] = [];
  const monthLabels: string[] = [];
  for (let w = 0; w < weeks; w++) {
    const col: Cell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      col.push(flat[w * 7 + dow] ?? { day: "", count: 0 });
    }
    cells.push(col);
    const firstOfWeek = flat[w * 7];
    const prevMonday = w === 0 ? null : flat[(w - 1) * 7]?.day ?? null;
    monthLabels.push(firstOfWeek ? monthTick(firstOfWeek.day, prevMonday) : "");
  }

  return { cells, monthLabels };
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function monthTick(dayIso: string, prevWeekFirstIso: string | null | undefined) {
  const [y, m] = dayIso.split("-").map(Number);
  if (prevWeekFirstIso) {
    const [py, pm] = prevWeekFirstIso.split("-").map(Number);
    if (pm === m && py === y) return "";
  }
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

function dayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
