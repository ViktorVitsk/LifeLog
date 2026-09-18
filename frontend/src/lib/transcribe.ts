import type { AppLocale } from "../i18n/locale";
import type { LlmSettings } from "../agent/types";

/** Prefer multi-provider Whisper; openai/whisper-1 is OpenAI-only and hits data-policy 404s. */
const STT_MODELS = [
  "openai/whisper-large-v3",
  "openai/whisper-large-v3-turbo",
  "qwen/qwen3-asr-1.7b",
  "mistralai/voxtral-mini-transcribe",
  "nvidia/parakeet-tdt-0.6b-v3",
];

const RECORDER_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function formatFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function isPolicyMiss(status: number, body: string): boolean {
  if (status !== 404 && status !== 400) return false;
  return /0 endpoints|data policy|guardrail|no endpoints/i.test(body);
}

export async function transcribeAudio(args: {
  blob: Blob;
  mime: string;
  settings: LlmSettings;
  locale: AppLocale;
  signal?: AbortSignal;
}): Promise<string> {
  if (!args.settings.api_key.trim()) {
    throw new Error("openrouter-key");
  }
  const data = await blobToBase64(args.blob);
  const root =
    args.settings.provider === "openrouter" && args.settings.base_url.trim()
      ? args.settings.base_url
      : "https://openrouter.ai/api/v1";
  const url = `${root.replace(/\/$/, "")}/audio/transcriptions`;
  const headers = {
    Authorization: `Bearer ${args.settings.api_key.trim()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": window.location.origin,
    "X-Title": "LifeLog",
  };
  const format = formatFromMime(args.mime || args.blob.type);
  const language = args.locale === "ru" ? "ru" : "en";

  let lastBody = "";
  let lastStatus = 0;
  for (const model of STT_MODELS) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        language,
        input_audio: { data, format },
      }),
      signal: args.signal,
    });
    if (res.ok) {
      const json = (await res.json()) as { text?: string };
      return (json.text ?? "").trim();
    }
    lastStatus = res.status;
    lastBody = await res.text().catch(() => "");
    if (isPolicyMiss(res.status, lastBody)) continue;
    throw new Error(`STT ${res.status}: ${lastBody.slice(0, 180)}`);
  }
  if (isPolicyMiss(lastStatus, lastBody)) {
    throw new Error("stt-policy");
  }
  throw new Error(`STT ${lastStatus}: ${lastBody.slice(0, 180)}`);
}
