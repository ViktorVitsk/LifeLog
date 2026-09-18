import { useState } from "react";
import BodyMetricsForm from "../components/checkin/BodyMetricsForm";
import DailyCheckinForm from "../components/checkin/DailyCheckinForm";
import EmotionalStateForm from "../components/checkin/EmotionalStateForm";
import GratitudeForm from "../components/checkin/GratitudeForm";
import HabitLogForm from "../components/checkin/HabitLogForm";
import SkillSessionForm from "../components/checkin/SkillSessionForm";
import SleepForm from "../components/checkin/SleepForm";
import ThoughtForm from "../components/checkin/ThoughtForm";
import { useLocale } from "../context/LocaleContext";
import { useSync } from "../context/SyncContext";

type EntryType =
  | "DAILY_CHECKIN"
  | "EMOTIONAL_STATE"
  | "SKILL_SESSION"
  | "HABIT_LOG"
  | "SLEEP"
  | "BODY_METRICS"
  | "THOUGHT"
  | "GRATITUDE";

export default function CheckinPage() {
  const { t } = useLocale();
  const [active, setActive] = useState<EntryType>("DAILY_CHECKIN");
  const [savedFlash, setSavedFlash] = useState(false);
  const sync = useSync();

  const tabs: { id: EntryType; label: string; hint: string }[] = [
    { id: "DAILY_CHECKIN", label: t.checkinDaily, hint: t.checkinDailyHint },
    { id: "EMOTIONAL_STATE", label: t.checkinEmotion, hint: t.checkinEmotionHint },
    { id: "SKILL_SESSION", label: t.checkinSkill, hint: t.checkinSkillHint },
    { id: "HABIT_LOG", label: t.checkinHabit, hint: t.checkinHabitHint },
    { id: "SLEEP", label: t.checkinSleep, hint: t.checkinSleepHint },
    { id: "BODY_METRICS", label: t.checkinBody, hint: t.checkinBodyHint },
    { id: "THOUGHT", label: t.checkinThought, hint: t.checkinThoughtHint },
    { id: "GRATITUDE", label: t.checkinGratitude, hint: t.checkinGratitudeHint },
  ];

  function onSubmitted() {
    setSavedFlash(true);
    sync.trigger();
    window.setTimeout(() => setSavedFlash(false), 2200);
  }

  const activeTab = tabs.find((tab) => tab.id === active)!;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.manualForms}</h1>
        <p className="text-sm text-zinc-400 mt-1">{activeTab.hint}</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded border border-zinc-800 p-0.5 text-xs sm:text-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`shrink-0 min-h-[44px] px-3 rounded ${
              active === tab.id ? "bg-indigo-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        {active === "DAILY_CHECKIN" && <DailyCheckinForm onSubmitted={onSubmitted} />}
        {active === "EMOTIONAL_STATE" && <EmotionalStateForm onSubmitted={onSubmitted} />}
        {active === "SKILL_SESSION" && <SkillSessionForm onSubmitted={onSubmitted} />}
        {active === "HABIT_LOG" && <HabitLogForm onSubmitted={onSubmitted} />}
        {active === "SLEEP" && <SleepForm onSubmitted={onSubmitted} />}
        {active === "BODY_METRICS" && <BodyMetricsForm onSubmitted={onSubmitted} />}
        {active === "THOUGHT" && <ThoughtForm onSubmitted={onSubmitted} />}
        {active === "GRATITUDE" && <GratitudeForm onSubmitted={onSubmitted} />}
      </div>

      {savedFlash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 text-white text-sm px-4 py-1.5 shadow-lg">
          {t.save}
        </div>
      )}
    </div>
  );
}
