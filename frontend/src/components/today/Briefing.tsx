import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ChartSpec } from "../../agent/types";
import { buildTodaySnapshot } from "../../agent/snapshot";
import LanguageSelect from "../LanguageSelect";
import { useLocale } from "../../context/LocaleContext";
import type { Habit, Skill } from "../../lib/api";
import type { MergedEntry } from "../../hooks/useEntries";
import ChartBlock from "./ChartBlock";

interface Props {
  entries: MergedEntry[];
  skills: Skill[];
  habits: Habit[];
  pinned: ChartSpec[];
}

export default function Briefing({ entries, skills, habits, pinned }: Props) {
  const { locale, t } = useLocale();
  const snap = useMemo(
    () => buildTodaySnapshot({ entries, skills, habits, locale }),
    [entries, skills, habits, locale],
  );

  const chips = [
    {
      k: "mood",
      label: t.mood,
      v: snap.averages.mood == null ? "—" : String(snap.averages.mood),
    },
    {
      k: "energy",
      label: t.energy,
      v: snap.averages.energy == null ? "—" : String(snap.averages.energy),
    },
    {
      k: "sleep",
      label: t.sleep,
      v:
        snap.sleep?.hours != null
          ? `${snap.sleep.hours}h`
          : snap.sleep
            ? t.sleepLogged
            : "—",
    },
    {
      k: "habits",
      label: t.habits,
      v:
        snap.habits.length === 0
          ? "—"
          : `${snap.habits.filter((h) => h.completed).length}/${snap.habits.length}`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{t.today}</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{snap.local_day}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelect compact />
          <Link
            to="/checkin"
            className="text-xs text-zinc-400 underline underline-offset-2 min-h-[44px] inline-flex items-center"
          >
            {t.manualForms}
          </Link>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {chips.map((c) => (
          <div
            key={c.k}
            className="shrink-0 min-w-[6.5rem] rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
          >
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{c.label}</div>
            <div className="text-lg font-semibold text-zinc-100">{c.v}</div>
          </div>
        ))}
      </div>

      {snap.gaps.length > 0 && (
        <div className="text-xs text-amber-200/90 bg-amber-950/30 border border-amber-900/50 rounded-lg px-3 py-2">
          {t.missing}: {snap.gaps.slice(0, 4).join(" · ")}
        </div>
      )}

      {pinned.map((spec, i) => (
        <ChartBlock key={`${spec.kind}-${i}`} spec={spec} compact />
      ))}
    </div>
  );
}
