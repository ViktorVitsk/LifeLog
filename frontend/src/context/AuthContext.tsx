import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { db } from "../db/offlineQueue";
import { deriveKEK, tryUnwrapDek } from "../lib/crypto";

/**
 * Auth state model.
 *
 * - `token`   : JWT. Mirrored to sessionStorage so a same-tab refresh
 *               doesn't force a full login round-trip.
 * - `salt`    : User's PBKDF2 salt (NOT secret — the server returns it on
 *               login). Mirrored to sessionStorage so we can re-derive the
 *               KEK locally after a refresh, without hitting the network.
 * - `kek`     : Key-Encryption-Key. STRICTLY memory-only. A page refresh
 *               wipes it — that's by design. Use `unlock(password)` to
 *               re-derive it.
 * - `username`: mirrored for UX.
 *
 * Derived flags:
 *   isFullyAuthenticated  — have token + kek, can encrypt/decrypt
 *   needsUnlock           — have token + salt but no kek (post-refresh)
 */

const SESSION_STORAGE_KEY = "lifelog.session";

interface PersistedSession {
  token: string;
  username: string;
  salt: string;
}

export interface AuthState {
  token: string | null;
  kek: CryptoKey | null;
  username: string | null;
  salt: string | null;
}

export interface AuthContextValue extends AuthState {
  setAuthenticated: (
    username: string,
    token: string,
    password: string,
    saltHex: string,
  ) => Promise<void>;
  /** Re-derive the KEK from the in-session salt + a freshly typed password. */
  unlock: (password: string) => Promise<void>;
  logout: () => void;
  isFullyAuthenticated: boolean;
  needsUnlock: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readPersisted(): PersistedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.token === "string" &&
      typeof parsed?.username === "string" &&
      typeof parsed?.salt === "string"
    ) {
      return parsed;
    }
  } catch {
    /* ignore malformed session */
  }
  return null;
}

function writePersisted(session: PersistedSession) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota / disabled storage */
  }
}

function clearPersisted() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super("wrong master password");
    this.name = "WrongPasswordError";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const persisted = readPersisted();
    return {
      token: persisted?.token ?? null,
      kek: null,
      username: persisted?.username ?? null,
      salt: persisted?.salt ?? null,
    };
  });

  const setAuthenticated = useCallback(
    async (username: string, token: string, password: string, saltHex: string) => {
      const kek = await deriveKEK(password, saltHex);
      writePersisted({ token, username, salt: saltHex });
      setState({ token, kek, username, salt: saltHex });
    },
    [],
  );

  const unlock = useCallback(async (password: string) => {
    const persisted = readPersisted();
    if (!persisted) throw new Error("no session to unlock");
    const kek = await deriveKEK(password, persisted.salt);

    // Best-effort verification: if Dexie has any entry, try to unwrap its
    // DEK. A wrong password fails here cleanly instead of corrupting
    // future submissions with an unusable KEK.
    const sample = await db.entries.limit(1).first();
    if (sample && !(await tryUnwrapDek(sample.encrypted_dek, kek))) {
      throw new WrongPasswordError();
    }

    setState({
      token: persisted.token,
      username: persisted.username,
      salt: persisted.salt,
      kek,
    });
  }, []);

  const logout = useCallback(() => {
    clearPersisted();
    setState({ token: null, kek: null, username: null, salt: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      setAuthenticated,
      unlock,
      logout,
      isFullyAuthenticated: Boolean(state.token && state.kek),
      needsUnlock: Boolean(state.token && state.salt && !state.kek),
    }),
    [state, setAuthenticated, unlock, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
