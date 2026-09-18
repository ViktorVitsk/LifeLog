import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { encryptAndEnqueue } from "../../lib/entrySubmit";
import Slider from "../ui/Slider";

type TimeOfDay = "morning" | "afternoon" | "evening";

export default function DailyCheckinForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek } = useAuth();
  const { t } = useLocale();
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(inferTimeOfDay());
  const [mood, setMood] = useState(7);
  const [energy, setEnergy] = useState(7);
  const [anxiety, setAnxiety] = useState(3);
  const [focus, setFocus] = useState(6);
  const [socialBattery, setSocialBattery] = useState(6);
  const [stress, setStress] = useState(3);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!kek) return;
    setBusy(true);
    setErr(null);
    try {
      await encryptAndEnqueue({
        kek,
        entry_type: "DAILY_CHECKIN",
        plaintext: {
          time_of_day: timeOfDay,
          notes,
        },
        openFields: {
          mood_score: mood,
          energy_score: energy,
          anxiety_score: anxiety,
          focus_score: focus,
          social_battery_score: socialBattery,
          stress_score: stress,
          tags: [timeOfDay],
        },
      });
      setNotes("");
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <TimeOfDaySelector value={timeOfDay} onChange={setTimeOfDay} />

      <div className="grid gap-4 md:grid-cols-2">
        <Slider label={t.mood} value={mood} onChange={setMood} />
        <Slider label={t.energy} value={energy} onChange={setEnergy} />
        <Slider label={t.anxiety} value={anxiety} onChange={setAnxiety} />
        <Slider label={t.focus} value={focus} onChange={setFocus} />
        <Slider label={t.socialBattery} value={socialBattery} onChange={setSocialBattery} />
        <Slider label={t.stress} value={stress} onChange={setStress} />
      </div>

      <div>
        <label className="text-sm text-zinc-300">{t.notesEncrypted}</label>
        <textarea
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-24"
          placeholder={t.notesPlaceholder}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {err && (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy}
        className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
      >
        {busy ? "…" : t.saveCheckin}
      </button>
    </div>
  );
}

function TimeOfDaySelector({
  value,
  onChange,
}: {
  value: TimeOfDay;
  onChange: (v: TimeOfDay) => void;
}) {
  const { t } = useLocale();
  const opts: { id: TimeOfDay; label: string }[] = [
    { id: "morning", label: t.morning },
    { id: "afternoon", label: t.afternoon },
    { id: "evening", label: t.evening },
  ];
  return (
    <div className="flex gap-1 rounded border border-zinc-800 p-0.5 text-sm">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`flex-1 py-1.5 rounded ${
            value === o.id ? "bg-indigo-600 text-white" : "text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function inferTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
