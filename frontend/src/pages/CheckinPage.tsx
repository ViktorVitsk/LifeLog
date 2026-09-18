import { useState } from "react";
import BodyMetricsForm from "../components/checkin/BodyMetricsForm";
import DailyCheckinForm from "../components/checkin/DailyCheckinForm";
import EmotionalStateForm from "../components/checkin/EmotionalStateForm";
import GratitudeForm from "../components/checkin/GratitudeForm";
import HabitLogForm from "../components/checkin/HabitLogForm";
import SkillSessionForm from "../components/checkin/SkillSessionForm";
import SleepForm from "../components/checkin/SleepForm";
import ThoughtForm from "../components/checkin/ThoughtForm";
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

const TABS: { id: EntryType; label: string; hint: string }[] = [
  { id: "DAILY_CHECKIN", label: "Daily", hint: "Morning / evening check-in" },
  { id: "EMOTIONAL_STATE", label: "Emotion", hint: "Gap-model work on a specific feeling" },
  { id: "SKILL_SESSION", label: "Skill", hint: "Practice session (uses skill metric schema)" },
  { id: "HABIT_LOG", label: "Habit", hint: "Mark a habit done (or log a value)" },
  { id: "SLEEP", label: "Sleep", hint: "Hours + quality (open); times & dreams encrypted" },
  { id: "BODY_METRICS", label: "Body", hint: "Weight / fat % open; other measures encrypted" },
  { id: "THOUGHT", label: "Thought", hint: "A free-form journal entry" },
  { id: "GRATITUDE", label: "Gratitude", hint: "Three specific things" },
];

export default function CheckinPage() {
  const [active, setActive] = useState<EntryType>("DAILY_CHECKIN");
  const [savedFlash, setSavedFlash] = useState(false);
  const sync = useSync();

  function onSubmitted() {
    setSavedFlash(true);
    sync.trigger();
    window.setTimeout(() => setSavedFlash(false), 2200);
  }

  const activeTab = TABS.find((t) => t.id === active)!;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check-in</h1>
        <p className="text-sm text-zinc-400 mt-1">{activeTab.hint}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1 rounded border border-zinc-800 p-0.5 text-xs sm:text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`py-1.5 rounded ${
              active === t.id ? "bg-indigo-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {t.label}
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
          Encrypted & queued for sync
        </div>
      )}
    </div>
  );
}
