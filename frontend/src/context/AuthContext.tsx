import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { db } from "../db/offlineQueue";
import {
  api,
  AUTH_EXPIRED_EVENT,
  isAuthError,
  resetAuthExpiredGate,
} from "../lib/api";
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
 *   sessionExpired        — JWT rejected; KEK may still be in memory
 */

const SESSION_STORAGE_KEY = "lifelog.session";
const REFRESH_SKEW_MS = 90_000;

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
  sessionExpired: boolean;
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
  /** Get a new JWT after expiry using the master password. */
  reauthenticate: (password: string) => Promise<void>;
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

/** Latest JWT from sessionStorage — queryFns should use this so a silent
 *  refresh is visible before React re-renders. */
export function getSessionToken(): string | null {
  return readPersisted()?.token ?? null;
}

function jwtExpMs(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super("wrong master password");
    this.name = "WrongPasswordError";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const recovering = useRef(false);

  const [state, setState] = useState<AuthState>(() => {
    const persisted = readPersisted();
    return {
      token: persisted?.token ?? null,
      kek: null,
      username: persisted?.username ?? null,
      salt: persisted?.salt ?? null,
      sessionExpired: false,
    };
  });

  const applyToken = useCallback((token: string) => {
    const persisted = readPersisted();
    if (persisted) writePersisted({ ...persisted, token });
    setState((s) => (s.token === token ? s : { ...s, token, sessionExpired: false }));
  }, []);

  const setAuthenticated = useCallback(
    async (username: string, token: string, password: string, saltHex: string) => {
      const kek = await deriveKEK(password, saltHex);
      resetAuthExpiredGate();
      writePersisted({ token, username, salt: saltHex });
      setState({ token, kek, username, salt: saltHex, sessionExpired: false });
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

    let token = persisted.token;
    try {
      const res = await api.refresh(token);
      token = res.access_token;
    } catch {
      const res = await api.login(persisted.username, password);
      token = res.access_token;
    }

    resetAuthExpiredGate();
    writePersisted({ token, username: persisted.username, salt: persisted.salt });
    setState({
      token,
      username: persisted.username,
      salt: persisted.salt,
      kek,
      sessionExpired: false,
    });
  }, []);

  const reauthenticate = useCallback(async (password: string) => {
    const persisted = readPersisted();
    const username = persisted?.username ?? state.username;
    const salt = persisted?.salt ?? state.salt;
    if (!username || !salt) throw new Error("no session to unlock");

    const kek = await deriveKEK(password, salt);
    const sample = await db.entries.limit(1).first();
    if (sample && !(await tryUnwrapDek(sample.encrypted_dek, kek))) {
      throw new WrongPasswordError();
    }

    const res = await api.login(username, password);
    resetAuthExpiredGate();
    writePersisted({ token: res.access_token, username, salt: res.salt || salt });
    setState({
      token: res.access_token,
      kek,
      username,
      salt: res.salt || salt,
      sessionExpired: false,
    });
    await queryClient.invalidateQueries();
  }, [queryClient, state.salt, state.username]);

  const logout = useCallback(() => {
    resetAuthExpiredGate();
    clearPersisted();
    queryClient.clear();
    setState({ token: null, kek: null, username: null, salt: null, sessionExpired: false });
  }, [queryClient]);

  const markSessionExpired = useCallback(() => {
    setState((s) => {
      if (s.sessionExpired && !s.token) return s;
      return { ...s, token: null, sessionExpired: Boolean(s.username || s.salt || s.kek) };
    });
  }, []);

  useEffect(() => {
    const onExpired = () => {
      if (recovering.current) return;
      recovering.current = true;
      const persisted = readPersisted();
      const token = persisted?.token;
      void (async () => {
        if (token) {
          try {
            const res = await api.refresh(token);
            applyToken(res.access_token);
            await queryClient.invalidateQueries();
            return;
          } catch (e) {
            if (!isAuthError(e)) return;
          }
        }
        markSessionExpired();
      })().finally(() => {
        recovering.current = false;
      });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [applyToken, markSessionExpired, queryClient]);

  useEffect(() => {
    if (!state.token || state.sessionExpired) return;
    const token = state.token;
    const exp = jwtExpMs(token);
    const delay = exp
      ? Math.max(5_000, exp - Date.now() - REFRESH_SKEW_MS)
      : 45 * 60_000;
    const timer = window.setTimeout(() => {
      void api
        .refresh(token)
        .then((res) => {
          applyToken(res.access_token);
        })
        .catch((e) => {
          if (isAuthError(e)) markSessionExpired();
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.token, state.sessionExpired, applyToken, markSessionExpired]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      setAuthenticated,
      unlock,
      reauthenticate,
      logout,
      isFullyAuthenticated: Boolean(state.token && state.kek && !state.sessionExpired),
      needsUnlock: Boolean(state.token && state.salt && !state.kek && !state.sessionExpired),
    }),
    [state, setAuthenticated, unlock, reauthenticate, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
