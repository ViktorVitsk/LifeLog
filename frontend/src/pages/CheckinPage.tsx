import { useState } from "react";
import DailyCheckinForm from "../components/checkin/DailyCheckinForm";
import GratitudeForm from "../components/checkin/GratitudeForm";
import ThoughtForm from "../components/checkin/ThoughtForm";
import { useSync } from "../context/SyncContext";

type EntryType = "DAILY_CHECKIN" | "THOUGHT" | "GRATITUDE";

const TABS: { id: EntryType; label: string; hint: string }[] = [
  { id: "DAILY_CHECKIN", label: "Daily", hint: "Morning / evening check-in" },
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

      <div className="flex gap-1 rounded border border-zinc-800 p-0.5 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`flex-1 py-1.5 rounded ${
              active === t.id ? "bg-indigo-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        {active === "DAILY_CHECKIN" && <DailyCheckinForm onSubmitted={onSubmitted} />}
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
