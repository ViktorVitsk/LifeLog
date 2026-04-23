import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { api, type EntryRead } from "./lib/api";
import { decryptEntry, encryptEntry } from "./lib/crypto";

type LogLine = { level: "info" | "ok" | "err"; text: string };

export default function App() {
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [noteText, setNoteText] = useState("Today I felt calm and focused.");
  const [moodScore, setMoodScore] = useState(7);
  const [entries, setEntries] = useState<(EntryRead & { decrypted?: string })[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);

  function pushLog(level: LogLine["level"], text: string) {
    setLog((l) => [...l, { level, text }]);
  }

  async function onRegister() {
    try {
      await api.register(username, password);
      pushLog("ok", `registered user "${username}"`);
    } catch (e) {
      pushLog("err", `register: ${(e as Error).message}`);
    }
  }

  async function onLogin() {
    try {
      const res = await api.login(username, password);
      await auth.setAuthenticated(username, res.access_token, password, res.salt);
      pushLog("ok", `logged in, KEK derived (salt len=${res.salt.length})`);
    } catch (e) {
      pushLog("err", `login: ${(e as Error).message}`);
    }
  }

  async function onEncryptAndSync() {
    if (!auth.token || !auth.kek) {
      pushLog("err", "not authenticated");
      return;
    }
    try {
      const plaintext = JSON.stringify({
        v: 1,
        content: noteText,
        mood_score: moodScore,
      });
      const { encryptedContent, encryptedDek } = await encryptEntry(plaintext, auth.kek);
      pushLog("info", `encrypted: content=${encryptedContent.length}b64, dek=${encryptedDek.length}b64`);

      const id = crypto.randomUUID();
      const resp = await api.syncEntries(
        [
          {
            id,
            timestamp: new Date().toISOString(),
            entry_type: "THOUGHT",
            tags: ["smoke-test"],
            mood_score: moodScore,
            encrypted_content: encryptedContent,
            encrypted_dek: encryptedDek,
          },
        ],
        auth.token,
      );
      pushLog("ok", `synced: ${resp.saved.length} saved`);
    } catch (e) {
      pushLog("err", `sync: ${(e as Error).message}`);
    }
  }

  async function onFetchAndDecrypt() {
    if (!auth.token || !auth.kek) {
      pushLog("err", "not authenticated");
      return;
    }
    try {
      const list = await api.listEntries(auth.token);
      const decrypted: (EntryRead & { decrypted?: string })[] = [];
      for (const e of list) {
        try {
          const plaintext = await decryptEntry(e.encrypted_content, e.encrypted_dek, auth.kek);
          decrypted.push({ ...e, decrypted: plaintext });
        } catch (err) {
          decrypted.push({ ...e, decrypted: `[decrypt error: ${(err as Error).message}]` });
        }
      }
      setEntries(decrypted);
      pushLog("ok", `fetched ${list.length} entries, decrypted locally`);
    } catch (e) {
      pushLog("err", `fetch: ${(e as Error).message}`);
    }
  }

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto space-y-6">
      <header className="border-b border-zinc-800 pb-4">
        <h1 className="text-2xl font-semibold">LifeLog — Phase 1 smoke test</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Round-trip: register → login → encrypt → sync → fetch → decrypt.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">1. Auth</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
            type="password"
            placeholder="master password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40"
            onClick={onRegister}
            disabled={!username || password.length < 8}
          >
            Register
          </button>
          <button
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
            onClick={onLogin}
            disabled={!username || password.length < 8}
          >
            Login &amp; derive KEK
          </button>
          {auth.token && (
            <button
              className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600"
              onClick={auth.logout}
            >
              Logout
            </button>
          )}
        </div>
        <div className="text-xs text-zinc-400">
          status:{" "}
          {auth.token ? (
            <span className="text-emerald-400">
              authenticated as {auth.username} (KEK in memory)
            </span>
          ) : (
            <span className="text-zinc-500">not authenticated</span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">2. Write &amp; sync an encrypted entry</h2>
        <textarea
          className="w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-24"
          placeholder="Your private note (will be encrypted client-side)"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <label className="text-sm">Mood (1–10):</label>
          <input
            type="range"
            min={1}
            max={10}
            value={moodScore}
            onChange={(e) => setMoodScore(Number(e.target.value))}
          />
          <span className="text-sm text-zinc-400 w-6">{moodScore}</span>
        </div>
        <button
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40"
          onClick={onEncryptAndSync}
          disabled={!auth.token}
        >
          Encrypt &amp; POST /api/entries/sync
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">3. Fetch &amp; decrypt</h2>
        <button
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
          onClick={onFetchAndDecrypt}
          disabled={!auth.token}
        >
          GET /api/entries &amp; decrypt locally
        </button>
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded border border-zinc-800 p-3 bg-zinc-900/50">
              <div className="text-xs text-zinc-500">
                {e.entry_type} · {new Date(e.timestamp).toLocaleString()} · mood={e.mood_score ?? "—"}
              </div>
              <div className="mt-1 text-sm font-mono whitespace-pre-wrap break-all">
                {e.decrypted}
              </div>
              <details className="mt-2 text-xs text-zinc-500">
                <summary className="cursor-pointer">raw ciphertext</summary>
                <div className="mt-1 break-all">content: {e.encrypted_content.slice(0, 80)}…</div>
                <div className="break-all">dek: {e.encrypted_dek.slice(0, 80)}…</div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Log</h2>
        <pre className="rounded bg-zinc-900 border border-zinc-800 p-3 text-xs leading-relaxed max-h-64 overflow-auto">
          {log.map((l, i) => (
            <div
              key={i}
              className={
                l.level === "ok"
                  ? "text-emerald-400"
                  : l.level === "err"
                    ? "text-rose-400"
                    : "text-zinc-300"
              }
            >
              [{l.level}] {l.text}
            </div>
          ))}
        </pre>
      </section>
    </div>
  );
}
