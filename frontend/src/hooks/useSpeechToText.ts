import { useEffect, useRef, useState } from "react";
import type { LlmSettings } from "../agent/types";
import type { AppLocale } from "../i18n/locale";
import type { TStrings } from "../i18n/strings";
import { pickRecorderMime, transcribeAudio } from "../lib/transcribe";

/**
 * Record locally (MediaRecorder), then transcribe via OpenRouter Whisper.
 * Chrome Web Speech uses Google and often fails with a bogus `network` error.
 */
export function useSpeechToText(locale: AppLocale, t: TStrings, settings: LlmSettings) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wantRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const prefixRef = useRef("");
  const onTextRef = useRef<(text: string) => void>(() => undefined);
  const abortRef = useRef<AbortController | null>(null);

  function releaseMic() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }

  function stopRecorder() {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        releaseMic();
        setListening(false);
      }
    } else {
      releaseMic();
      setListening(false);
    }
  }

  useEffect(() => () => stopRecorder(), []);

  async function finishBlob(blob: Blob) {
    setListening(false);
    releaseMic();
    if (blob.size < 800) {
      setError(t.voiceEmpty);
      return;
    }
    if (!settings.api_key.trim()) {
      setError(t.voiceNeedKey);
      return;
    }
    setTranscribing(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const text = await transcribeAudio({
        blob,
        mime: mimeRef.current || blob.type,
        settings,
        locale,
        signal: ac.signal,
      });
      if (!text) {
        setError(t.voiceEmpty);
        return;
      }
      const prefix = prefixRef.current;
      onTextRef.current(`${prefix}${text}`.trimStart());
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message;
      setError(
        msg === "openrouter-key" ? t.voiceNeedKey : msg === "stt-policy" ? t.voicePolicy : `${t.voiceError}: ${msg.slice(0, 180)}`,
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function toggle(currentText: string, onText: (next: string) => void) {
    setError(null);
    onTextRef.current = onText;
    if (transcribing) return;
    if (wantRef.current) {
      stopRecorder();
      return;
    }

    if (!settings.api_key.trim()) {
      setError(t.voiceNeedKey);
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError(t.voiceNeedChrome);
      return;
    }

    const mime = pickRecorderMime();
    mimeRef.current = mime;
    prefixRef.current = currentText && !currentText.endsWith(" ") ? `${currentText} ` : currentText;
    chunksRef.current = [];

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t.voiceDenied);
      return;
    }

    let rec: MediaRecorder;
    try {
      rec = mime
        ? new MediaRecorder(streamRef.current, { mimeType: mime })
        : new MediaRecorder(streamRef.current);
    } catch {
      releaseMic();
      setError(t.voiceError);
      return;
    }

    rec.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onerror = () => {
      setError(t.voiceError);
      wantRef.current = false;
      releaseMic();
      setListening(false);
    };
    rec.onstop = () => {
      const type = mimeRef.current || rec.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      recRef.current = null;
      void finishBlob(blob);
    };

    recRef.current = rec;
    wantRef.current = true;
    rec.start(250);
    setListening(true);
  }

  return { listening, transcribing, error, toggle, stop: stopRecorder };
}
