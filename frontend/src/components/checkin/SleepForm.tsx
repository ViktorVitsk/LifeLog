import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { encryptAndEnqueue } from "../../lib/entrySubmit";
import Slider from "../ui/Slider";

export default function SleepForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek } = useAuth();
  const { t } = useLocale();
  const [sleepHours, setSleepHours] = useState(7.5);
  const [sleepQuality, setSleepQuality] = useState(7);
  const [bedtime, setBedtime] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [dreamNotes, setDreamNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!kek) return;
    setBusy(true);
    setErr(null);
    try {
      await encryptAndEnqueue({
        kek,
        entry_type: "SLEEP",
        plaintext: {
          bedtime: bedtime || undefined,
          wake_time: wakeTime || undefined,
          dream_notes: dreamNotes || undefined,
        },
        openFields: {
          sleep_hours: sleepHours,
          sleep_quality: sleepQuality,
          tags: ["sleep"],
        },
      });
      setBedtime("");
      setWakeTime("");
      setDreamNotes("");
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="text-sm text-zinc-300">{t.sleepDuration}</label>
        <input
          type="number"
          min={0}
          max={24}
          step={0.25}
          value={sleepHours}
          onChange={(e) => setSleepHours(Number(e.target.value))}
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
        />
      </div>
      <Slider label={t.sleepQuality} value={sleepQuality} onChange={setSleepQuality} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm text-zinc-300">{t.bedtime}</label>
          <input
            type="time"
            value={bedtime}
            onChange={(e) => setBedtime(e.target.value)}
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">{t.wakeTime}</label>
          <input
            type="time"
            value={wakeTime}
            onChange={(e) => setWakeTime(e.target.value)}
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-zinc-300">{t.dreamNotes}</label>
        <textarea
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-20"
          placeholder={t.dreamPlaceholder}
          value={dreamNotes}
          onChange={(e) => setDreamNotes(e.target.value)}
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
        {busy ? "…" : t.saveSleep}
      </button>
    </div>
  );
}
