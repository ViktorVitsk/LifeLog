import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LanguageSelect from "../components/LanguageSelect";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { api } from "../lib/api";

type Mode = "login" | "register";

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.isFullyAuthenticated) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await api.register(username, password);
      }
      const res = await api.login(username, password);
      await auth.setAuthenticated(username, res.access_token, password, res.salt);
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">LifeLog</h1>
            <p className="text-sm text-zinc-400 mt-1">
              {mode === "login" ? t.loginHint : t.registerHint}
            </p>
          </div>
          <LanguageSelect compact />
        </div>

        <div className="flex rounded border border-zinc-800 p-0.5 text-sm">
          <button
            type="button"
            className={`flex-1 min-h-[44px] rounded ${mode === "login" ? "bg-indigo-600 text-white" : "text-zinc-400"}`}
            onClick={() => setMode("login")}
          >
            {t.loginTitle}
          </button>
          <button
            type="button"
            className={`flex-1 min-h-[44px] rounded ${mode === "register" ? "bg-indigo-600 text-white" : "text-zinc-400"}`}
            onClick={() => setMode("register")}
          >
            {t.registerTitle}
          </button>
        </div>

        <div className="space-y-2">
          <input
            className="w-full min-h-[44px] rounded bg-zinc-900 border border-zinc-700 px-3"
            placeholder={t.username}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="w-full min-h-[44px] rounded bg-zinc-900 border border-zinc-700 px-3"
            type="password"
            placeholder={t.masterPassword}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username || password.length < 8}
          className="w-full min-h-[44px] rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
        >
          {busy ? "…" : mode === "login" ? t.loginSubmit : t.registerSubmit}
        </button>

        <p className="text-[11px] text-zinc-500 text-center">{t.kekHint}</p>
      </form>
    </div>
  );
}
