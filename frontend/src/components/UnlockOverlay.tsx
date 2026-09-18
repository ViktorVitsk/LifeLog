import { useState } from "react";
import { useAuth, KeyUnverifiedError, WrongPasswordError } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";

/**
 * Modal shown when:
 * - same-tab refresh wiped the in-memory KEK, or
 * - the JWT expired / was rejected and we need a new access token.
 * Unlocking is local (PBKDF2). Re-auth hits /api/auth/login.
 */
export default function UnlockOverlay() {
  const { username, unlock, reauthenticate, logout, sessionExpired } = useAuth();
  const { t } = useLocale();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || password.length < 8) return;
    setError(null);
    setBusy(true);
    try {
      if (sessionExpired) await reauthenticate(password);
      else await unlock(password);
      setPassword("");
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        setError(t.wrongPassword);
      } else if (e instanceof KeyUnverifiedError) {
        setError(t.kekUnverified);
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
          <h2 className="text-lg font-semibold">
            {sessionExpired ? t.sessionExpiredTitle : t.unlockTitle}
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            {sessionExpired ? t.sessionExpiredBody : t.unlockBody}
          </p>
          {username && (
            <p className="text-xs text-zinc-500 mt-2">
              {t.unlockLoggedIn} <span className="text-zinc-300">{username}</span>.
            </p>
          )}
        </div>

        <input
          autoFocus
          className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2"
          type="password"
          autoComplete="current-password"
          placeholder={t.masterPassword}
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
            {busy ? "…" : sessionExpired ? t.sessionExpiredSubmit : t.unlockSubmit}
          </button>
          <button
            type="button"
            onClick={logout}
            className="px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            {t.logout}
          </button>
        </div>
      </form>
    </div>
  );
}
