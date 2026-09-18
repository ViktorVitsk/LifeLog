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
import {
  api,
  AUTH_EXPIRED_EVENT,
  isAuthError,
  resetAuthExpiredGate,
} from "../lib/api";
import { deriveKEK } from "../lib/crypto";
import {
  jwtSub,
  setCurrentUserId,
  setEncryptAllowed,
} from "../lib/accountScope";
import { establishKek, KeyUnverifiedError } from "../lib/kekUnlock";

const SESSION_STORAGE_KEY = "lifelog.session";
const REFRESH_SKEW_MS = 90_000;

interface PersistedSession {
  token: string;
  username: string;
  salt: string;
  userId: string;
}

export interface AuthState {
  token: string | null;
  kek: CryptoKey | null;
  username: string | null;
  salt: string | null;
  userId: string | null;
  sessionExpired: boolean;
  kekVerified: boolean;
}

export interface AuthContextValue extends AuthState {
  setAuthenticated: (
    username: string,
    token: string,
    password: string,
    saltHex: string,
  ) => Promise<void>;
  unlock: (password: string) => Promise<void>;
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
      typeof parsed?.salt === "string" &&
      typeof parsed?.userId === "string" &&
      parsed.userId
    ) {
      return parsed;
    }
    if (
      typeof parsed?.token === "string" &&
      typeof parsed?.username === "string" &&
      typeof parsed?.salt === "string"
    ) {
      const userId = jwtSub(parsed.token);
      if (!userId) return null;
      const next = { token: parsed.token, username: parsed.username, salt: parsed.salt, userId };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      return next;
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

export function getSessionToken(): string | null {
  return readPersisted()?.token ?? null;
}

export function getSessionUserId(): string | null {
  return readPersisted()?.userId ?? null;
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

export { KeyUnverifiedError };

async function resolveUserId(token: string): Promise<string> {
  try {
    const me = await api.me(token);
    if (me?.id) return me.id;
  } catch {
    /* fall through to JWT */
  }
  const sub = jwtSub(token);
  if (!sub) throw new Error("missing_user_id");
  return sub;
}

function applyScope(userId: string | null, encryptOk: boolean) {
  setCurrentUserId(userId);
  setEncryptAllowed(encryptOk);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const recovering = useRef(false);

  const [state, setState] = useState<AuthState>(() => {
    const persisted = readPersisted();
    if (persisted?.userId) setCurrentUserId(persisted.userId);
    setEncryptAllowed(false);
    return {
      token: persisted?.token ?? null,
      kek: null,
      username: persisted?.username ?? null,
      salt: persisted?.salt ?? null,
      userId: persisted?.userId ?? null,
      sessionExpired: false,
      kekVerified: false,
    };
  });

  const applyToken = useCallback((token: string) => {
    const persisted = readPersisted();
    if (persisted) writePersisted({ ...persisted, token });
    setState((s) => (s.token === token ? s : { ...s, token, sessionExpired: false }));
  }, []);

  const setAuthenticated = useCallback(
    async (username: string, token: string, password: string, saltHex: string) => {
      const userId = await resolveUserId(token);
      applyScope(userId, false);
      const kek = await deriveKEK(password, saltHex);
      const result = await establishKek({ kek, token, userId, allowBootstrap: true });
      if (result === "wrong_password") throw new WrongPasswordError();
      if (result !== "verified") throw new KeyUnverifiedError();
      applyScope(userId, true);
      resetAuthExpiredGate();
      writePersisted({ token, username, salt: saltHex, userId });
      queryClient.clear();
      setState({
        token,
        kek,
        username,
        salt: saltHex,
        userId,
        sessionExpired: false,
        kekVerified: true,
      });
    },
    [queryClient],
  );

  const unlock = useCallback(async (password: string) => {
    const persisted = readPersisted();
    if (!persisted) throw new Error("no session to unlock");
    applyScope(persisted.userId, false);
    const kek = await deriveKEK(password, persisted.salt);

    const result = await establishKek({
      kek,
      token: persisted.token,
      userId: persisted.userId,
      allowBootstrap: false,
    });
    if (result === "wrong_password") throw new WrongPasswordError();
    if (result !== "verified") throw new KeyUnverifiedError();

    let token = persisted.token;
    try {
      const res = await api.refresh(token);
      token = res.access_token;
    } catch {
      const res = await api.login(persisted.username, password);
      token = res.access_token;
    }

    applyScope(persisted.userId, true);
    resetAuthExpiredGate();
    writePersisted({ ...persisted, token });
    setState({
      token,
      username: persisted.username,
      salt: persisted.salt,
      userId: persisted.userId,
      kek,
      sessionExpired: false,
      kekVerified: true,
    });
  }, []);

  const reauthenticate = useCallback(async (password: string) => {
    const persisted = readPersisted();
    const username = persisted?.username ?? state.username;
    const salt = persisted?.salt ?? state.salt;
    const userId = persisted?.userId ?? state.userId;
    if (!username || !salt || !userId) throw new Error("no session to unlock");

    applyScope(userId, false);
    const kek = await deriveKEK(password, salt);
    const res = await api.login(username, password);
    const result = await establishKek({
      kek,
      token: res.access_token,
      userId,
      allowBootstrap: true,
    });
    if (result === "wrong_password") throw new WrongPasswordError();
    if (result !== "verified") throw new KeyUnverifiedError();

    applyScope(userId, true);
    resetAuthExpiredGate();
    writePersisted({
      token: res.access_token,
      username,
      salt: res.salt || salt,
      userId,
    });
    setState({
      token: res.access_token,
      kek,
      username,
      salt: res.salt || salt,
      userId,
      sessionExpired: false,
      kekVerified: true,
    });
    await queryClient.invalidateQueries();
  }, [queryClient, state.salt, state.username, state.userId]);

  const logout = useCallback(() => {
    resetAuthExpiredGate();
    clearPersisted();
    applyScope(null, false);
    queryClient.clear();
    setState({
      token: null,
      kek: null,
      username: null,
      salt: null,
      userId: null,
      sessionExpired: false,
      kekVerified: false,
    });
  }, [queryClient]);

  const markSessionExpired = useCallback(() => {
    setEncryptAllowed(false);
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
      isFullyAuthenticated: Boolean(
        state.token && state.kek && state.kekVerified && !state.sessionExpired,
      ),
      needsUnlock: Boolean(
        state.token && state.salt && (!state.kek || !state.kekVerified) && !state.sessionExpired,
      ),
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
