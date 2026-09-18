const rawBase = import.meta.env.VITE_API_URL;
/** Empty = same origin (Vite proxies `/api` → LifeLog backend). */
const BASE_URL = (typeof rawBase === "string" ? rawBase.trim() : "").replace(/\/$/, "");

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

/**
 * Thrown when the server rejects the JWT (expired, rotated secret, missing
 * Bearer). Callers must not retry: a new access token is required.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError;
}

export const AUTH_EXPIRED_EVENT = "lifelog-auth-expired";

let authExpiredNotified = false;

export function resetAuthExpiredGate(): void {
  authExpiredNotified = false;
}

function emitAuthExpired(): void {
  if (authExpiredNotified) return;
  authExpiredNotified = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

export interface RegisterResponse {
  salt: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  salt: string;
}

export interface MeResponse {
  id: string;
  username: string;
  timezone?: string;
  encrypted_kek_verifier_content?: string | null;
  encrypted_kek_verifier_dek?: string | null;
}

export interface EntrySyncPayload {
  id: string;
  timestamp: string; // ISO UTC
  entry_type: string;
  skill_id?: string | null;
  habit_id?: string | null;
  context_id?: string | null;
  goal_id?: string | null;
  tags: string[];
  mood_score?: number | null;
  energy_score?: number | null;
  anxiety_score?: number | null;
  focus_score?: number | null;
  social_battery_score?: number | null;
  stress_score?: number | null;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  session_duration_min?: number | null;
  habit_completed?: boolean | null;
  habit_value?: number | null;
  resentment_score?: number | null;
  guilt_score?: number | null;
  shame_score?: number | null;
  fear_score?: number | null;
  encrypted_dek: string;
  encrypted_content: string;
  version?: number | null;
  deleted?: boolean;
  recorded_at?: string | null;
  event_timezone?: string | null;
}

export interface EntryRead extends EntrySyncPayload {
  created_at: string;
  synced_from_offline: boolean;
}

export type ExportMetadataRow = Omit<EntryRead, "encrypted_dek" | "encrypted_content">;

export interface ExportPage {
  items: ExportMetadataRow[];
  offset: number;
  limit: number;
  total: number;
  next_offset: number | null;
}

export interface TrendPoint {
  day: string;
  value: number;
  n?: number;
}

export interface TrendSeries {
  period: string;
  period_days: number;
  metric: string;
  aggregation: string;
  unit: string;
  scale_min?: number | null;
  scale_max?: number | null;
  observations: number;
  days_with_data: number;
  coverage: number;
  insufficient: boolean;
  points: TrendPoint[];
}

export interface CorrelationPoint {
  day: string;
  x: number;
  y: number;
  n_x?: number;
  n_y?: number;
}

export interface CorrelationSeries {
  period: string;
  period_days: number;
  x: string;
  y: string;
  lag_days: number;
  observations: number;
  days_with_data: number;
  coverage: number;
  insufficient: boolean;
  points: CorrelationPoint[];
}

export type HabitFrequency = "daily" | "weekly";

export interface Skill {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  metric_schema: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  frequency: HabitFrequency;
  target_value: number | null;
  unit: string | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
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

  const hdrs = new Headers(headers);
  if (token) hdrs.set("Authorization", `Bearer ${token}`);
  if (rest.body != null && !hdrs.has("Content-Type")) {
    hdrs.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: hdrs,
    });
  } catch (e) {
    // `TypeError: Failed to fetch` / ERR_INTERNET_DISCONNECTED / CORS etc.
    // All genuinely-network failures surface here.
    throw new NetworkError("server unreachable", e);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const message = `${res.status} ${res.statusText}${text ? `: ${text}` : ""}`;
    if (res.status === 401) {
      // Login/register: form error. Refresh: caller falls back to login.
      if (!path.startsWith("/api/auth/")) {
        emitAuthExpired();
      }
      throw new AuthError(message, 401);
    }
    throw new Error(message);
  }
  if (res.ok && token) resetAuthExpiredGate();
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  async register(username: string, password: string, timezone?: string): Promise<RegisterResponse> {
    return request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, timezone }),
    });
  },

  async login(username: string, password: string): Promise<LoginResponse> {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  async refresh(token: string): Promise<{ access_token: string; token_type: string }> {
    return request("/api/auth/refresh", {
      method: "POST",
      token,
    });
  },

  async me(token: string): Promise<MeResponse> {
    return request("/api/auth/me", { token });
  },

  async putTimezone(token: string, timezone: string): Promise<MeResponse> {
    return request("/api/auth/timezone", {
      method: "PUT",
      token,
      body: JSON.stringify({ timezone }),
    });
  },

  async putKekVerifier(
    token: string,
    body: { encrypted_content: string; encrypted_dek: string },
  ): Promise<void> {
    await request("/api/auth/kek-verifier", {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    });
  },

  async syncEntries(
    entries: EntrySyncPayload[],
    token: string,
  ): Promise<{
    saved: string[];
    errors: unknown[];
    results?: { id: string; status: string; reason?: string | null }[];
  }> {
    return request("/api/entries/sync", {
      method: "POST",
      token,
      body: JSON.stringify({ entries }),
    });
  },

  async listEntries(
    token: string,
    params?: {
      skill_id?: string;
      habit_id?: string;
      entry_type?: string;
      tag?: string;
      start_date?: string;
      end_date?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<EntryRead[]> {
    const q = new URLSearchParams();
    if (params?.skill_id) q.set("skill_id", params.skill_id);
    if (params?.habit_id) q.set("habit_id", params.habit_id);
    if (params?.entry_type) q.set("entry_type", params.entry_type);
    if (params?.tag) q.set("tag", params.tag);
    if (params?.start_date) q.set("start_date", params.start_date);
    if (params?.end_date) q.set("end_date", params.end_date);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return request(`/api/entries${qs ? `?${qs}` : ""}`, { token });
  },

  async getTrends(
    token: string,
    params: {
      metric: string;
      period?: "7d" | "30d" | "90d" | "1y";
      habit_id?: string;
      skill_id?: string;
    },
  ): Promise<TrendSeries> {
    const q = new URLSearchParams();
    q.set("metric", params.metric);
    if (params.period) q.set("period", params.period);
    if (params.habit_id) q.set("habit_id", params.habit_id);
    if (params.skill_id) q.set("skill_id", params.skill_id);
    const raw = await request<TrendSeries | TrendPoint[]>(`/api/analytics/trends?${q.toString()}`, { token });
    return Array.isArray(raw)
      ? {
          period: params.period ?? "30d",
          period_days: raw.length,
          metric: params.metric,
          aggregation: "avg",
          unit: "",
          observations: raw.length,
          days_with_data: raw.length,
          coverage: 0,
          insufficient: raw.length === 0,
          points: raw,
        }
      : raw;
  },

  async getCorrelations(
    token: string,
    params: {
      x: string;
      y: string;
      period?: "7d" | "30d" | "90d" | "1y";
      lag_days?: number;
      habit_id?: string;
      skill_id?: string;
    },
  ): Promise<CorrelationSeries> {
    const q = new URLSearchParams();
    q.set("x", params.x);
    q.set("y", params.y);
    if (params.period) q.set("period", params.period);
    if (params.lag_days != null) q.set("lag_days", String(params.lag_days));
    if (params.habit_id) q.set("habit_id", params.habit_id);
    if (params.skill_id) q.set("skill_id", params.skill_id);
    const raw = await request<CorrelationSeries | CorrelationPoint[]>(
      `/api/analytics/correlations?${q.toString()}`,
      { token },
    );
    return Array.isArray(raw)
      ? {
          period: params.period ?? "30d",
          period_days: raw.length,
          x: params.x,
          y: params.y,
          lag_days: params.lag_days ?? 0,
          observations: raw.length,
          days_with_data: raw.length,
          coverage: 0,
          insufficient: raw.length === 0,
          points: raw,
        }
      : raw;
  },

  async exportMetadata(
    token: string,
    params?: { limit?: number; offset?: number },
  ): Promise<ExportPage> {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    const raw = await request<ExportPage | ExportMetadataRow[]>(
      `/api/export/metadata${qs ? `?${qs}` : ""}`,
      { token },
    );
    if (Array.isArray(raw)) {
      return {
        items: raw,
        offset: params?.offset ?? 0,
        limit: params?.limit ?? raw.length,
        total: raw.length,
        next_offset: null,
      };
    }
    return raw;
  },

  async listSkills(token: string): Promise<Skill[]> {
    return request("/api/skills", { token });
  },

  async createSkill(
    token: string,
    body: {
      name: string;
      color?: string | null;
      icon?: string | null;
      metric_schema?: Record<string, unknown>;
    },
  ): Promise<Skill> {
    return request("/api/skills", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  async updateSkill(
    token: string,
    id: string,
    body: Partial<{
      name: string;
      color: string | null;
      icon: string | null;
      metric_schema: Record<string, unknown>;
      is_active: boolean;
    }>,
  ): Promise<Skill> {
    return request(`/api/skills/${id}`, {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    });
  },

  async listHabits(token: string): Promise<Habit[]> {
    return request("/api/habits", { token });
  },

  async createHabit(
    token: string,
    body: {
      name: string;
      frequency?: HabitFrequency;
      target_value?: number | null;
      unit?: string | null;
      color?: string | null;
    },
  ): Promise<Habit> {
    return request("/api/habits", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  async updateHabit(
    token: string,
    id: string,
    body: Partial<{
      name: string;
      frequency: HabitFrequency;
      target_value: number | null;
      unit: string | null;
      color: string | null;
      is_active: boolean;
    }>,
  ): Promise<Habit> {
    return request(`/api/habits/${id}`, {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    });
  },

  async getLife(token: string): Promise<LifeBundle> {
    return request("/api/life", { token });
  },

  async syncLifeGoals(token: string, items: LifeGoalSync[]): Promise<LifeSyncResponse> {
    return request("/api/life/goals/sync", { method: "POST", token, body: JSON.stringify({ items }) });
  },

  async syncLifeMemory(token: string, items: LifeMemorySync[]): Promise<LifeSyncResponse> {
    return request("/api/life/memory/sync", { method: "POST", token, body: JSON.stringify({ items }) });
  },

  async syncLifeActions(token: string, items: LifeActionSync[]): Promise<LifeSyncResponse> {
    return request("/api/life/actions/sync", { method: "POST", token, body: JSON.stringify({ items }) });
  },

  async syncLifeFeedback(token: string, items: LifeFeedbackSync[]): Promise<LifeSyncResponse> {
    return request("/api/life/feedback/sync", { method: "POST", token, body: JSON.stringify({ items }) });
  },
};

export interface LifeSyncResponse {
  results: { id: string; status: string; reason?: string | null; version?: number | null }[];
  saved: string[];
}

export interface LifeGoalSync {
  id: string;
  state: string;
  review_at?: string | null;
  habit_ids?: string[];
  skill_ids?: string[];
  entry_ids?: string[];
  encrypted_dek: string;
  encrypted_content: string;
  version?: number;
  deleted?: boolean;
}

export interface LifeMemorySync {
  id: string;
  kind: string;
  state: string;
  origin?: string;
  reviewed_at?: string | null;
  entry_ids?: string[];
  encrypted_dek: string;
  encrypted_content: string;
  version?: number;
  deleted?: boolean;
}

export interface LifeActionSync {
  id: string;
  goal_id: string;
  state: string;
  result_metric?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  review_at?: string | null;
  encrypted_dek: string;
  encrypted_content: string;
  version?: number;
  deleted?: boolean;
}

export interface LifeFeedbackSync {
  id: string;
  action_id: string;
  outcome_kind: string;
  encrypted_dek: string;
  encrypted_content: string;
  version?: number;
  deleted?: boolean;
}

export interface LifeGoalRead extends LifeGoalSync {
  created_at: string;
  updated_at: string;
}

export interface LifeMemoryRead extends LifeMemorySync {
  created_at: string;
  updated_at: string;
}

export interface LifeActionRead extends LifeActionSync {
  created_at: string;
  updated_at: string;
}

export interface LifeFeedbackRead extends LifeFeedbackSync {
  created_at: string;
  updated_at: string;
}

export interface LifeBundle {
  goals: LifeGoalRead[];
  memory: LifeMemoryRead[];
  actions: LifeActionRead[];
  feedback: LifeFeedbackRead[];
  due_action_ids: string[];
}
