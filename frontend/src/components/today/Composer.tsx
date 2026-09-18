import { useEffect, useRef, useState } from "react";
import type { LlmSettings } from "../../agent/types";
import { useLocale } from "../../context/LocaleContext";
import { useSpeechToText } from "../../hooks/useSpeechToText";

interface Props {
  disabled?: boolean;
  keyboardInset: number;
  tabBarVisible: boolean;
  settings: LlmSettings;
  onSend: (text: string) => void;
}

const MIN_H = 96;
const MAX_H = 240;

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_H), MAX_H)}px`;
}

export default function Composer({
  disabled,
  keyboardInset,
  tabBarVisible,
  settings,
  onSend,
}: Props) {
  const { locale, t } = useLocale();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeechToText(locale, t, settings);

  useEffect(() => {
    autosize(taRef.current);
  }, [text]);

  const chips = [
    { id: "sleep", label: t.chipSleep, prompt: t.promptSleep },
    { id: "checkin", label: t.chipCheckin, prompt: t.promptCheckin },
    { id: "emotion", label: t.chipEmotion, prompt: t.promptEmotion },
    { id: "habit", label: t.chipHabit, prompt: t.promptHabit },
    { id: "thought", label: t.chipThought, prompt: t.promptThought },
  ];

  function send() {
    const next = text.trim();
    if (!next || disabled) return;
    if (speech.listening) speech.stop();
    setText("");
    onSend(next);
  }

  const placeholder = speech.transcribing
    ? t.voiceTranscribing
    : speech.listening
      ? t.voiceRecording
      : t.composerPlaceholder;

  return (
    <div
      className="border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-3 pt-2"
      style={{
        paddingBottom:
          keyboardInset > 40 ? 8 : tabBarVisible ? 8 : "max(0.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className="shrink-0 min-h-[36px] px-3 rounded-full border border-zinc-700 text-xs text-zinc-300"
            onClick={() => {
              setText((prev) => (prev ? prev : c.prompt));
              requestAnimationFrame(() => taRef.current?.focus());
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {speech.error && (
        <div className="mb-2 rounded border border-rose-800 bg-rose-950/40 text-rose-100 text-xs px-2 py-1.5">
          {speech.error}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          rows={4}
          value={text}
          disabled={disabled || speech.transcribing}
          placeholder={placeholder}
          className="flex-1 resize-none rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2.5 text-sm overflow-y-auto"
          style={{ minHeight: MIN_H, maxHeight: MAX_H }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          aria-label={speech.listening ? t.stopVoice : t.voice}
          disabled={speech.transcribing}
          onClick={() => void speech.toggle(text, setText)}
          className={`min-h-[44px] min-w-[44px] rounded-xl border text-xs disabled:opacity-40 ${
            speech.listening ? "border-rose-500 bg-rose-950 text-rose-100" : "border-zinc-700 text-zinc-200"
          }`}
        >
          {speech.transcribing ? "…" : speech.listening ? "■" : "🎙"}
        </button>
        <button
          type="button"
          disabled={disabled || speech.transcribing || !text.trim()}
          onClick={send}
          className="min-h-[44px] min-w-[44px] rounded-xl bg-indigo-600 text-sm disabled:opacity-40"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
