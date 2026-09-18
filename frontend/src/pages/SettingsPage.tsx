import { useState } from "react";
import { useAuth } from "../context/AuthContext";
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
  const { token, kek } = useAuth();
  const { entries } = useEntries();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function onMetadataExport() {
    if (!token) return;
    setBusy("meta");
    setMsg(null);
    try {
      const rows = await api.exportMetadata(token, { limit: 10_000 });
      downloadJson(`lifelog-metadata-${new Date().toISOString().slice(0, 10)}.json`, rows);
      setMsg(`Downloaded ${rows.length} metadata rows (no ciphertext).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onFullExport() {
    if (!kek) {
      setMsg("Unlock with your master password to build a decrypted export.");
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
      downloadJson(`lifelog-full-${new Date().toISOString().slice(0, 10)}.json`, out);
      setMsg(`Full export: ${out.length} entries (merged local + server).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">Data export (Phase 5).</p>
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-200">Export</h2>
        <p className="text-xs text-zinc-500">
          Metadata export uses the server API and excludes ciphertext. Full export runs in your
          browser: every merged entry is decrypted with your KEK and downloaded as JSON. Keep the
          file private.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!token || busy !== null}
            onClick={() => void onMetadataExport()}
            className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-40"
          >
            {busy === "meta" ? "…" : "Download metadata JSON"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onFullExport()}
            className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-sm disabled:opacity-40"
          >
            {busy === "full" ? "…" : "Download full decrypted JSON"}
          </button>
        </div>
        {msg && <p className="text-xs text-zinc-400">{msg}</p>}
      </section>
    </div>
  );
}
