const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * Thrown when fetch itself fails (offline, DNS failure, CORS preflight
 * rejection, server unreachable). Callers should treat this as "try again
 * later" and keep showing cached data instead of crashing the UI.
 */
export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}

export interface RegisterResponse {
  salt: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  salt: string;
}

export interface EntrySyncPayload {
  id: string;
  timestamp: string; // ISO UTC
  entry_type: string;
  skill_id?: string | null;
  habit_id?: string | null;
  context_id?: string | null;
  tags: string[];
  mood_score?: number | null;
  energy_score?: number | null;
  anxiety_score?: number | null;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  session_duration_min?: number | null;
  habit_completed?: boolean | null;
  habit_value?: number | null;
  resentment_score?: number | null;
  guilt_score?: number | null;
  shame_score?: number | null;
  fear_score?: number | null;
  encrypted_dek: string;
  encrypted_content: string;
}

export interface EntryRead extends EntrySyncPayload {
  created_at: string;
  synced_from_offline: boolean;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;

  // Fail fast while offline — don't even attempt the fetch. This keeps
  // DevTools clean and lets the UI route the error through NetworkError.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new NetworkError("offline");
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch (e) {
    // `TypeError: Failed to fetch` / ERR_INTERNET_DISCONNECTED / CORS etc.
    // All genuinely-network failures surface here.
    throw new NetworkError("server unreachable", e);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  async register(username: string, password: string): Promise<RegisterResponse> {
    return request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  async login(username: string, password: string): Promise<LoginResponse> {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  async syncEntries(
    entries: EntrySyncPayload[],
    token: string,
  ): Promise<{ saved: string[]; errors: unknown[] }> {
    return request("/api/entries/sync", {
      method: "POST",
      token,
      body: JSON.stringify({ entries }),
    });
  },

  async listEntries(token: string): Promise<EntryRead[]> {
    return request("/api/entries", { token });
  },
};
