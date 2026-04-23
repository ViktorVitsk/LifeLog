import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { encryptAndEnqueue } from "../../lib/entrySubmit";

export default function GratitudeForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek } = useAuth();
  const [items, setItems] = useState<string[]>(["", "", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function updateItem(idx: number, value: string) {
    setItems((xs) => xs.map((x, i) => (i === idx ? value : x)));
  }

  async function submit() {
    if (!kek) return;
    const cleaned = items.map((i) => i.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await encryptAndEnqueue({
        kek,
        entry_type: "GRATITUDE",
        plaintext: { items: cleaned },
        openFields: { tags: ["gratitude"] },
      });
      setItems(["", "", ""]);
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Three specific things you're grateful for today. Stored encrypted.
      </p>
      <div className="space-y-2">
        {items.map((val, idx) => (
          <input
            key={idx}
            className="w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
            placeholder={`${idx + 1}. Something specific…`}
            value={val}
            onChange={(e) => updateItem(idx, e.target.value)}
          />
        ))}
      </div>

      {err && (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || items.every((i) => !i.trim())}
        className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
      >
        {busy ? "…" : "Save gratitude"}
      </button>
    </div>
  );
}
