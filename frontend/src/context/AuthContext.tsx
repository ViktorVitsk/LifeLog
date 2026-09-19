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
import { authErrorStillCurrent, authResultStillCurrent } from "../lib/authSession";
import { setAccountTimeZone } from "../lib/dates";

const SESSION_STORAGE_KEY = "lifelog.session";
const REFRESH_SKEW_MS = 90_000;

interface PersistedSession {
  token: string;
  username: string;
  salt: string;
  userId: string;
  kdfVersion: number;
}

export interface AuthState {
  token: string | null;
  kek: CryptoKey | null;
  username: string | null;
  salt: string | null;
  userId: string | null;
  sessionExpired: boolean;
  kekVerified: boolean;
  timezone: string;
}

export interface AuthContextValue extends AuthState {
  setAuthenticated: (
    username: string,
    token: string,
    password: string,
    saltHex: string,
    kdfVersion?: number,
  ) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  reauthenticate: (password: string) => Promise<void>;
  logout: () => void;
  updateTimezone: (timezone: string) => Promise<void>;
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
      const next = {
        token: parsed.token,
        username: parsed.username,
        salt: parsed.salt,
        userId: parsed.userId,
        kdfVersion: typeof parsed.kdfVersion === "number" ? parsed.kdfVersion : 1,
      };
      if (parsed.kdfVersion !== next.kdfVersion) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    }
    if (
      typeof parsed?.token === "string" &&
      typeof parsed?.username === "string" &&
      typeof parsed?.salt === "string"
    ) {
      const userId = jwtSub(parsed.token);
      if (!userId) return null;
      const next = {
        token: parsed.token,
        username: parsed.username,
        salt: parsed.salt,
        userId,
        kdfVersion: 1,
      };
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

async function resolveUserId(token: string): Promise<{ userId: string; timezone: string }> {
  try {
    const me = await api.me(token);
    if (me?.id) {
      const timezone = me.timezone || "UTC";
      setAccountTimeZone(timezone);
      return { userId: me.id, timezone };
    }
  } catch {
    /* fall through to JWT */
  }
  const sub = jwtSub(token);
  if (!sub) throw new Error("missing_user_id");
  return { userId: sub, timezone: "UTC" };
}

function applyScope(userId: string | null, encryptOk: boolean) {
  setCurrentUserId(userId);
  setEncryptAllowed(encryptOk);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const recovering = useRef(false);
  const authGen = useRef(0);

  const beginAuthOp = () => {
    authGen.current += 1;
    return authGen.current;
  };

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
      timezone: "UTC",
    };
  });

  const applyToken = useCallback((token: string, opGen?: number) => {
    const persisted = readPersisted();
    const gen = opGen ?? authGen.current;
    const userId = persisted?.userId ?? null;
    if (!persisted || !userId) return;
    if (!authResultStillCurrent({ token, expectedUserId: userId, opGen: gen, currentGen: authGen.current, currentUserId: userId })) {
      return;
    }
    writePersisted({ ...persisted, token });
    setState((s) => (s.token === token ? s : { ...s, token, sessionExpired: false }));
  }, []);

  const setAuthenticated = useCallback(
    async (
      username: string,
      token: string,
      password: string,
      saltHex: string,
      kdfVersion = 1,
    ) => {
      const gen = beginAuthOp();
      const { userId, timezone } = await resolveUserId(token);
      if (
        !authResultStillCurrent({
          token,
          expectedUserId: userId,
          opGen: gen,
          currentGen: authGen.current,
          currentUserId: userId,
        })
      ) {
        return;
      }
      applyScope(userId, false);
      const kek = await deriveKEK(password, saltHex, kdfVersion);
      const result = await establishKek({ kek, token, userId, allowBootstrap: true });
      if (result === "wrong_password") throw new WrongPasswordError();
      if (result !== "verified") throw new KeyUnverifiedError();
      if (gen !== authGen.current) return;
      applyScope(userId, true);
      resetAuthExpiredGate();
      writePersisted({ token, username, salt: saltHex, userId, kdfVersion });
      queryClient.clear();
      setState({
        token,
        kek,
        username,
        salt: saltHex,
        userId,
        sessionExpired: false,
        kekVerified: true,
        timezone,
      });
    },
    [queryClient],
  );

  const unlock = useCallback(async (password: string) => {
    const persisted = readPersisted();
    if (!persisted) throw new Error("no session to unlock");
    const gen = beginAuthOp();
    const expectedUserId = persisted.userId;
    applyScope(expectedUserId, false);
    const kek = await deriveKEK(password, persisted.salt, persisted.kdfVersion);

    const result = await establishKek({
      kek,
      token: persisted.token,
      userId: expectedUserId,
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
    const current = readPersisted();
    if (
      !authResultStillCurrent({
        token,
        expectedUserId,
        opGen: gen,
        currentGen: authGen.current,
        currentUserId: current?.userId ?? null,
      })
    ) {
      return;
    }

    applyScope(expectedUserId, true);
    resetAuthExpiredGate();
    writePersisted({ ...persisted, token });
    let timezone = "UTC";
    try {
      const me = await api.me(token);
      timezone = me.timezone || timezone;
      setAccountTimeZone(timezone);
    } catch {
      /* keep UTC */
    }
    if (gen !== authGen.current) return;
    setState({
      token,
      username: persisted.username,
      salt: persisted.salt,
      userId: expectedUserId,
      kek,
      sessionExpired: false,
      kekVerified: true,
      timezone,
    });
  }, []);

  const reauthenticate = useCallback(async (password: string) => {
    const persisted = readPersisted();
    const username = persisted?.username ?? state.username;
    const salt = persisted?.salt ?? state.salt;
    const userId = persisted?.userId ?? state.userId;
    if (!username || !salt || !userId) throw new Error("no session to unlock");
    const gen = beginAuthOp();

    applyScope(userId, false);
    const res = await api.login(username, password);
    const kdfVersion = res.kdf_version ?? persisted?.kdfVersion ?? 1;
    const kek = await deriveKEK(password, res.salt || salt, kdfVersion);
    const result = await establishKek({
      kek,
      token: res.access_token,
      userId,
      allowBootstrap: true,
    });
    if (result === "wrong_password") throw new WrongPasswordError();
    if (result !== "verified") throw new KeyUnverifiedError();

    if (
      !authResultStillCurrent({
        token: res.access_token,
        expectedUserId: userId,
        opGen: gen,
        currentGen: authGen.current,
        currentUserId: readPersisted()?.userId ?? userId,
      })
    ) {
      return;
    }
    applyScope(userId, true);
    resetAuthExpiredGate();
    writePersisted({
      token: res.access_token,
      username,
      salt: res.salt || salt,
      userId,
      kdfVersion,
    });
    let timezone = state.timezone || "UTC";
    try {
      const me = await api.me(res.access_token);
      timezone = me.timezone || timezone;
      setAccountTimeZone(timezone);
    } catch {
      /* keep previous */
    }
    if (gen !== authGen.current) return;
    setState({
      token: res.access_token,
      kek,
      username,
      salt: res.salt || salt,
      userId,
      sessionExpired: false,
      kekVerified: true,
      timezone,
    });
    await queryClient.invalidateQueries();
  }, [queryClient, state.salt, state.username, state.userId]);

  const logout = useCallback(() => {
    beginAuthOp();
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
      timezone: "UTC",
    });
    setAccountTimeZone("UTC");
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
      const gen = authGen.current;
      const expectedUserId = persisted?.userId;
      void (async () => {
        if (token && expectedUserId) {
          try {
            const res = await api.refresh(token);
            if (
              !authResultStillCurrent({
                token: res.access_token,
                expectedUserId,
                opGen: gen,
                currentGen: authGen.current,
                currentUserId: readPersisted()?.userId ?? null,
              })
            ) {
              return;
            }
            applyToken(res.access_token, gen);
            await queryClient.invalidateQueries();
            return;
          } catch (e) {
            if (!isAuthError(e)) return;
          }
        }
        if (
          authErrorStillCurrent({
            opGen: gen,
            currentGen: authGen.current,
            expectedUserId: expectedUserId ?? "",
            currentUserId: readPersisted()?.userId ?? null,
          })
        ) {
          markSessionExpired();
        }
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
    const gen = authGen.current;
    const expectedUserId = readPersisted()?.userId;
    const timer = window.setTimeout(() => {
      void api
        .refresh(token)
        .then((res) => {
          if (!expectedUserId) return;
          if (
            !authResultStillCurrent({
              token: res.access_token,
              expectedUserId,
              opGen: gen,
              currentGen: authGen.current,
              currentUserId: readPersisted()?.userId ?? null,
            })
          ) {
            return;
          }
          applyToken(res.access_token, gen);
        })
        .catch((e) => {
          if (!isAuthError(e)) return;
          if (
            !authErrorStillCurrent({
              opGen: gen,
              currentGen: authGen.current,
              expectedUserId: expectedUserId ?? "",
              currentUserId: readPersisted()?.userId ?? null,
            })
          ) {
            return;
          }
          markSessionExpired();
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.token, state.sessionExpired, applyToken, markSessionExpired]);

  const updateTimezone = useCallback(
    async (timezone: string) => {
      if (!state.token || !state.userId) throw new Error("not authenticated");
      const gen = authGen.current;
      const expectedUserId = state.userId;
      const me = await api.putTimezone(state.token, timezone);
      const zone = me.timezone || timezone;
      if (
        !authResultStillCurrent({
          token: state.token,
          expectedUserId,
          opGen: gen,
          currentGen: authGen.current,
          currentUserId: readPersisted()?.userId ?? null,
        })
      ) {
        return;
      }
      setAccountTimeZone(zone);
      setState((s) => (s.userId === expectedUserId ? { ...s, timezone: zone } : s));
    },
    [state.token, state.userId],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      setAuthenticated,
      unlock,
      reauthenticate,
      logout,
      updateTimezone,
      isFullyAuthenticated: Boolean(
        state.token && state.kek && state.kekVerified && !state.sessionExpired,
      ),
      needsUnlock: Boolean(
        state.token && state.salt && (!state.kek || !state.kekVerified) && !state.sessionExpired,
      ),
    }),
    [state, setAuthenticated, unlock, reauthenticate, logout, updateTimezone],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
