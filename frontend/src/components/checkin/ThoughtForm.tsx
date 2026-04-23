import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { encryptAndEnqueue } from "../../lib/entrySubmit";
import Slider from "../ui/Slider";

export default function ThoughtForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek } = useAuth();
  const [content, setContent] = useState("");
  const [mood, setMood] = useState(6);
  const [tagsRaw, setTagsRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!kek || !content.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const tags = tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await encryptAndEnqueue({
        kek,
        entry_type: "THOUGHT",
        plaintext: { content, mood_score: mood },
        openFields: { mood_score: mood, tags },
      });
      setContent("");
      setTagsRaw("");
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-zinc-300">Thought (encrypted)</label>
        <textarea
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-32"
          placeholder="A free-form thought…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      <Slider label="Mood when writing" value={mood} onChange={setMood} />

      <div>
        <label className="text-sm text-zinc-300">Tags (open, comma-separated)</label>
        <input
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          placeholder="work, family, reflection"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
        />
        <div className="text-[11px] text-zinc-500 mt-1">
          Tags stay unencrypted so they can be used for filtering and analytics.
        </div>
      </div>

      {err && (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !content.trim()}
        className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
      >
        {busy ? "…" : "Save thought"}
      </button>
    </div>
  );
}
