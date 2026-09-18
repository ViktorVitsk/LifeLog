import { useEffect, useState } from "react";
import { loadLlmSettings, probeLlm, saveLlmSettings } from "../agent/settingsStore";
import { exportDecryptedTurns } from "../agent/chatStore";
import { DEFAULT_LLM_SETTINGS, type ContextPolicy, type LlmProviderId, type LlmSettings } from "../agent/types";
import LanguageSelect from "../components/LanguageSelect";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useEntries, type MergedEntry } from "../hooks/useEntries";
import { api } from "../lib/api";
import { decryptEntry } from "../lib/crypto";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stripCipher(e: MergedEntry) {
  const { encrypted_content: _c, encrypted_dek: _d, ...rest } = e;
  return rest;
}

export default function SettingsPage() {
  const { token, kek, logout, username } = useAuth();
  const { t } = useLocale();
  const { entries } = useEntries();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmSettings>({ ...DEFAULT_LLM_SETTINGS });
  const [probe, setProbe] = useState<string | null>(null);

  useEffect(() => {
    if (!kek) return;
    void loadLlmSettings(kek).then(setLlm);
  }, [kek]);

  async function onMetadataExport() {
    if (!token) return;
    setBusy("meta");
    setMsg(null);
    try {
      const rows = await api.exportMetadata(token, { limit: 10_000 });
      downloadJson(`lifelog-metadata-${new Date().toISOString().slice(0, 10)}.json`, rows);
      setMsg(`${rows.length}`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onFullExport() {
    if (!kek) {
      setMsg(t.unlockForExport);
      return;
    }
    setBusy("full");
    setMsg(null);
    try {
      const out: Record<string, unknown>[] = [];
      for (const e of entries) {
        const base = stripCipher(e);
        try {
          const raw = await decryptEntry(e.encrypted_content, e.encrypted_dek, kek);
          const plaintext = JSON.parse(raw) as unknown;
          out.push({ ...base, plaintext });
        } catch {
          out.push({ ...base, plaintext: null, decrypt_error: true });
        }
      }
      const chat = await exportDecryptedTurns(kek);
      downloadJson(`lifelog-full-${new Date().toISOString().slice(0, 10)}.json`, {
        entries: out,
        chat_turns: chat,
      });
      setMsg(`${out.length} + ${chat.length}`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onSaveLlm() {
    if (!kek) return;
    setBusy("llm");
    setMsg(null);
    try {
      await saveLlmSettings(llm, kek);
      setMsg(t.agentSaved);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onProbe() {
    setBusy("probe");
    setProbe(null);
    try {
      const r = await probeLlm(llm);
      setProbe(`${r.ok ? "OK" : "Fail"} — ${r.detail}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 max-w-xl mx-auto pb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.settingsTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">
          {t.settingsIntro} {username}.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">{t.language}</h2>
        <LanguageSelect hideLabel />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">{t.agent}</h2>
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100/90 text-xs p-3">
          {t.privacyBanner}
        </div>
        <label className="block text-sm">
          {t.provider}
          <select
            className="mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
            value={llm.provider}
            onChange={(e) => {
              const provider = e.target.value as LlmProviderId;
              setLlm((s) => ({
                ...s,
                provider,
                base_url:
                  provider === "ollama"
                    ? "http://localhost:11434/v1"
                    : "https://openrouter.ai/api/v1",
                model: provider === "ollama" ? "qwen2.5:7b" : "deepseek/deepseek-v4.1-flash",
              }));
            }}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </label>
        <label className="block text-sm">
          {t.model}
          <input
            className="mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
            value={llm.model}
            onChange={(e) => setLlm((s) => ({ ...s, model: e.target.value }))}
            placeholder="deepseek/deepseek-v4.1-flash"
          />
        </label>
        <label className="block text-sm">
          {t.baseUrl}
          <input
            className="mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
            value={llm.base_url}
            onChange={(e) => setLlm((s) => ({ ...s, base_url: e.target.value }))}
          />
        </label>
        {llm.provider === "openrouter" && (
          <label className="block text-sm">
            {t.apiKey}
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
              value={llm.api_key}
              onChange={(e) => setLlm((s) => ({ ...s, api_key: e.target.value }))}
              placeholder="sk-or-…"
            />
          </label>
        )}
        <label className="block text-sm">
          {t.contextPolicy}
          <select
            className="mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
            value={llm.context_policy}
            onChange={(e) =>
              setLlm((s) => ({ ...s, context_policy: e.target.value as ContextPolicy }))
            }
          >
            <option value="today">{t.contextToday}</option>
            <option value="7d_open">{t.context7d}</option>
            <option value="decrypt_n">{t.contextDecrypt}</option>
          </select>
        </label>
        {llm.context_policy === "decrypt_n" && (
          <label className="block text-sm">
            {t.decryptN}
            <input
              type="number"
              min={1}
              max={20}
              className="mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
              value={llm.decrypt_n}
              onChange={(e) => setLlm((s) => ({ ...s, decrypt_n: Number(e.target.value) }))}
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || !kek}
            onClick={() => void onSaveLlm()}
            className="min-h-[44px] px-4 rounded bg-indigo-600 text-sm disabled:opacity-40"
          >
            {busy === "llm" ? "…" : t.saveAgent}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onProbe()}
            className="min-h-[44px] px-4 rounded border border-zinc-700 text-sm disabled:opacity-40"
          >
            {busy === "probe" ? "…" : t.testConnection}
          </button>
        </div>
        {probe && <p className="text-xs text-zinc-400">{probe}</p>}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">{t.export}</h2>
        <p className="text-xs text-zinc-500">{t.exportHint}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!token || busy !== null}
            onClick={() => void onMetadataExport()}
            className="min-h-[44px] px-3 rounded bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-40"
          >
            {busy === "meta" ? "…" : t.downloadMeta}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onFullExport()}
            className="min-h-[44px] px-3 rounded bg-indigo-600 hover:bg-indigo-500 text-sm disabled:opacity-40"
          >
            {busy === "full" ? "…" : t.downloadFull}
          </button>
        </div>
        {msg && <p className="text-xs text-zinc-400">{msg}</p>}
      </section>

      <section className="md:hidden">
        <button
          type="button"
          onClick={logout}
          className="w-full min-h-[44px] rounded border border-zinc-700 text-sm"
        >
          {t.logout}
        </button>
      </section>
    </div>
  );
}
