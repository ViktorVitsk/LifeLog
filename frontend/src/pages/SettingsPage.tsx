import { useEffect, useState } from "react";
import { loadLlmSettings, probeLlm, saveLlmSettings } from "../agent/settingsStore";
import { exportDecryptedTurns } from "../agent/chatStore";
import { DEFAULT_LLM_SETTINGS, type ContextPolicy, type LlmProviderId, type LlmSettings } from "../agent/types";
import LanguageSelect from "../components/LanguageSelect";
import OrphanRecovery from "../components/OrphanRecovery";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { api, type EntryRead, type ExportMetadataRow } from "../lib/api";
import { COMMON_TIMEZONES } from "../lib/dates";
import { decryptEntry } from "../lib/crypto";
import { collectArrayPages, collectPages } from "../lib/paging";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stripCipher(e: EntryRead | ExportMetadataRow) {
  const { encrypted_content: _c, encrypted_dek: _d, ...rest } = e as EntryRead;
  return rest;
}

export default function SettingsPage() {
  const { token, kek, logout, username, timezone, updateTimezone } = useAuth();
  const { t } = useLocale();
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
      const { items, pages } = await collectPages(
        (offset, limit) => api.exportMetadata(token, { offset, limit }),
        200,
      );
      downloadJson(`lifelog-metadata-${new Date().toISOString().slice(0, 10)}.json`, {
        items,
        total: items.length,
        pages,
      });
      setMsg(`${items.length}`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onFullExport() {
    if (!token || !kek) {
      setMsg(t.unlockForExport);
      return;
    }
    setBusy("full");
    setMsg(null);
    try {
      const { items: rows, pages } = await collectArrayPages(
        (offset, limit) => api.listEntries(token, { limit, offset }),
        200,
      );
      const out: Record<string, unknown>[] = [];
      const decrypt_errors: { id: string; reason: string }[] = [];
      for (const e of rows) {
        const base = stripCipher(e);
        try {
          const raw = await decryptEntry(e.encrypted_content, e.encrypted_dek, kek);
          const plaintext = JSON.parse(raw) as unknown;
          out.push({ ...base, plaintext });
        } catch {
          decrypt_errors.push({ id: e.id, reason: "decrypt_failed" });
          out.push({ ...base, plaintext: null, decrypt_error: true });
        }
      }
      const chat = await exportDecryptedTurns(kek);
      downloadJson(`lifelog-full-${new Date().toISOString().slice(0, 10)}.json`, {
        generated_at: new Date().toISOString(),
        timezone,
        entries: out,
        chat_turns: chat,
        report: {
          entry_pages: pages,
          entry_count: out.length,
          decrypt_ok: out.length - decrypt_errors.length,
          decrypt_error_count: decrypt_errors.length,
          decrypt_errors,
        },
      });
      setMsg(
        t.exportReport
          .replace("{n}", String(out.length))
          .replace("{chat}", String(chat.length))
          .replace("{err}", String(decrypt_errors.length)),
      );
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

      <OrphanRecovery />

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">{t.language}</h2>
        <LanguageSelect hideLabel />
        <label className="block text-sm">
          {t.timezone}
          <select
            className="mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
            value={timezone}
            onChange={(e) => void updateTimezone(e.target.value).then(() => setMsg(t.timezoneSaved)).catch((err) => setMsg((err as Error).message))}
          >
            {!COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number]) && timezone && (
              <option value={timezone}>{timezone}</option>
            )}
            {COMMON_TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-zinc-500">{t.timezoneHint}</p>
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
