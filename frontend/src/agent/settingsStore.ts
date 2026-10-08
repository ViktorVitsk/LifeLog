import { db, type StoredLlmSettings } from "../db/offlineQueue";
import { decryptEntry, encryptEntry } from "../lib/crypto";
import { getCurrentUserId, requireCurrentUserId } from "../lib/accountScope";
import { DEFAULT_LLM_SETTINGS, type LlmSettings } from "./types";

export async function loadLlmSettings(kek: CryptoKey | null): Promise<LlmSettings> {
  const owner = getCurrentUserId();
  if (!owner) return { ...DEFAULT_LLM_SETTINGS };
  const row = await db.llm_settings.get(owner);
  if (!row) return { ...DEFAULT_LLM_SETTINGS };
  let api_key = "";
  if (kek && row.encrypted_api_key && row.encrypted_api_key_dek) {
    try {
      const raw = await decryptEntry(row.encrypted_api_key, row.encrypted_api_key_dek, kek);
      const parsed = JSON.parse(raw) as { key?: string };
      api_key = typeof parsed.key === "string" ? parsed.key : "";
    } catch {
      api_key = "";
    }
  }
  return {
    provider: row.provider,
    model: row.model,
    base_url: row.base_url,
    context_policy: row.context_policy,
    decrypt_n: row.decrypt_n,
    api_key,
    auto_save_enabled: false,
  };
}

export async function saveLlmSettings(settings: LlmSettings, kek: CryptoKey): Promise<void> {
  const owner = requireCurrentUserId();
  let encrypted_api_key: string | undefined;
  let encrypted_api_key_dek: string | undefined;
  if (settings.api_key.trim()) {
    const wrapped = await encryptEntry(JSON.stringify({ key: settings.api_key.trim() }), kek);
    encrypted_api_key = wrapped.encryptedContent;
    encrypted_api_key_dek = wrapped.encryptedDek;
  }
  const row: StoredLlmSettings = {
    id: owner,
    owner_user_id: owner,
    provider: settings.provider,
    model: settings.model.trim() || DEFAULT_LLM_SETTINGS.model,
    base_url:
      settings.base_url.trim() ||
      (settings.provider === "ollama"
        ? "http://localhost:11434/v1"
        : settings.provider === "synthetic"
          ? "synthetic://local"
          : "https://openrouter.ai/api/v1"),
    context_policy: settings.context_policy,
    decrypt_n: Math.max(1, Math.min(20, settings.decrypt_n || 5)),
    encrypted_api_key,
    encrypted_api_key_dek,
  };
  await db.llm_settings.put(row);
}

export async function probeLlm(settings: LlmSettings): Promise<{ ok: boolean; detail: string }> {
  try {
    if (settings.provider === "synthetic") {
      if (import.meta.env.PROD) return { ok: false, detail: "Synthetic provider is development-only" };
      return { ok: true, detail: "Synthetic in-process completeChat" };
    }
    if (settings.provider === "ollama") {
      const root = settings.base_url.replace(/\/v1\/?$/, "");
      const res = await fetch(`${root}/api/tags`);
      if (!res.ok) return { ok: false, detail: `${res.status} ${res.statusText}` };
      const body = (await res.json()) as { models?: { name: string }[] };
      const names = (body.models ?? []).map((m) => m.name).slice(0, 8);
      return {
        ok: true,
        detail: names.length ? `Ollama: ${names.join(", ")}` : "Ollama reachable (no models listed)",
      };
    }
    if (!settings.api_key.trim()) return { ok: false, detail: "OpenRouter API key is empty" };
    const res = await fetch(`${settings.base_url.replace(/\/$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${settings.api_key.trim()}`,
        "HTTP-Referer": window.location.origin,
        "X-Title": "LifeLog",
      },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, detail: `${res.status} ${t.slice(0, 180)}` };
    }
    return { ok: true, detail: "OpenRouter: models endpoint OK" };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
