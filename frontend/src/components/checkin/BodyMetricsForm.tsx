import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { encryptAndEnqueue } from "../../lib/entrySubmit";

export default function BodyMetricsForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek } = useAuth();
  const { t } = useLocale();
  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [restingHr, setRestingHr] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!kek) return;
    const w = weightKg.trim() === "" ? null : Number(weightKg);
    const bf = bodyFatPct.trim() === "" ? null : Number(bodyFatPct);
    if (w != null && (Number.isNaN(w) || w <= 0)) {
      setErr(t.weightPositive);
      return;
    }
    if (bf != null && (Number.isNaN(bf) || bf < 0 || bf > 100)) {
      setErr(t.bodyFatRange);
      return;
    }
    setBusy(true);
    setErr(null);
    const waistNum = waistCm.trim() === "" ? undefined : Number(waistCm);
    const hrNum = restingHr.trim() === "" ? undefined : Number(restingHr);
    if (waistNum !== undefined && Number.isNaN(waistNum)) {
      setErr(t.waistNumber);
      setBusy(false);
      return;
    }
    if (hrNum !== undefined && Number.isNaN(hrNum)) {
      setErr(t.hrNumber);
      setBusy(false);
      return;
    }
    try {
      await encryptAndEnqueue({
        kek,
        entry_type: "BODY_METRICS",
        plaintext: {
          waist_cm: waistNum,
          resting_hr: hrNum,
          notes: notes || undefined,
        },
        openFields: {
          weight_kg: w,
          body_fat_pct: bf,
          tags: ["body"],
        },
      });
      setWeightKg("");
      setBodyFatPct("");
      setWaistCm("");
      setRestingHr("");
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
      <p className="text-xs text-zinc-500">{t.bodyHint}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm text-zinc-300">{t.weightOpen}</label>
          <input
            type="number"
            min={0}
            step={0.1}
            placeholder="e.g. 72.4"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">{t.bodyFatOpen}</label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            placeholder={t.optional}
            value={bodyFatPct}
            onChange={(e) => setBodyFatPct(e.target.value)}
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">{t.waistEnc}</label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={waistCm}
            onChange={(e) => setWaistCm(e.target.value)}
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">{t.restingHrEnc}</label>
          <input
            type="number"
            min={0}
            value={restingHr}
            onChange={(e) => setRestingHr(e.target.value)}
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-zinc-300">{t.notesEncrypted}</label>
        <textarea
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-20"
          placeholder={t.bodyNotesPlaceholder}
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
        {busy ? "…" : t.saveBody}
      </button>
    </div>
  );
}
