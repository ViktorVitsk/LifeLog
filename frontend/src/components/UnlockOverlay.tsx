import { useState } from "react";
import { useAuth, WrongPasswordError } from "../context/AuthContext";

/**
 * Modal shown after a same-tab refresh: the JWT and the user's salt are
 * still in sessionStorage, but the in-memory KEK is gone. We ask for the
 * master password, re-derive the KEK locally (no network needed), and
 * verify it against any existing local entry before accepting.
 */
export default function UnlockOverlay() {
  const { username, unlock, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || password.length < 8) return;
    setError(null);
    setBusy(true);
    try {
      await unlock(password);
      setPassword("");
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        setError("Wrong password.");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
      >
        <div>
          <h2 className="text-lg font-semibold">Re-enter master password</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Your session is still valid, but the encryption key lives only in
            memory and was lost on refresh. Type your master password to
            re-derive it.
          </p>
          {username && (
            <p className="text-xs text-zinc-500 mt-2">
              Logged in as <span className="text-zinc-300">{username}</span>.
            </p>
          )}
        </div>

        <input
          autoFocus
          className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2"
          type="password"
          autoComplete="current-password"
          placeholder="master password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || password.length < 8}
            className="flex-1 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
          <button
            type="button"
            onClick={logout}
            className="px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>

        <p className="text-[11px] text-zinc-500 text-center">
          This happens locally. The password never leaves your browser.
        </p>
      </form>
    </div>
  );
}
