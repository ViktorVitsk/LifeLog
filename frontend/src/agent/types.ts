export const ENTRY_TYPES = [
  "DAILY_CHECKIN",
  "EMOTIONAL_STATE",
  "GRATITUDE",
  "SKILL_SESSION",
  "HABIT_LOG",
  "SLEEP",
  "MEAL",
  "SUPPLEMENT",
  "BODY_METRICS",
  "THOUGHT",
  "GOAL_UPDATE",
  "BELIEF",
] as const;

export type EntryTypeName = (typeof ENTRY_TYPES)[number];

export type Provenance = "user_stated" | "agent_extracted" | "agent_inferred";

export type ContextPolicy = "today" | "7d_open" | "decrypt_n";

export type ChatMode = "record" | "analyze" | "review";

export interface LifeProposal {
  id: string;
  kind: "memory" | "action";
  title: string;
  body: Record<string, unknown>;
}

export type LlmProviderId = "openrouter" | "ollama" | "synthetic";

export interface LlmSettings {
  provider: LlmProviderId;
  model: string;
  base_url: string;
  context_policy: ContextPolicy;
  decrypt_n: number;
  /** Decrypted in memory only. */
  api_key: string;
  /** Reserved. Always false in this stage — the model cannot enable it. */
  auto_save_enabled?: boolean;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: "openrouter",
  model: "deepseek/deepseek-v4.1-flash",
  base_url: "https://openrouter.ai/api/v1",
  context_policy: "today",
  decrypt_n: 5,
  api_key: "",
  auto_save_enabled: false,
};

export interface ProposedEntry {
  id: string;
  entry_type: EntryTypeName;
  confidence: number;
  provenance: Provenance;
  /** Ignored at persist time. Reserved for a future client-side setting. */
  auto_commit?: boolean;
  issues?: { field: string; message: string }[];
  reason?: string;
  tags?: string[];
  timestamp?: string;
  time_of_day?: "morning" | "afternoon" | "evening";
  mood_score?: number | null;
  energy_score?: number | null;
  anxiety_score?: number | null;
  focus_score?: number | null;
  social_battery_score?: number | null;
  stress_score?: number | null;
  notes?: string;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  bedtime?: string;
  wake_time?: string;
  dream_notes?: string;
  resentment_score?: number | null;
  guilt_score?: number | null;
  shame_score?: number | null;
  fear_score?: number | null;
  resentment?: { expectation?: string; reality?: string; trigger?: string };
  guilt?: { my_action?: string; perceived_expectation?: string };
  shame?: { action?: string; ideal_self?: string };
  fear?: { threat?: string; missing_solution?: string };
  reflection?: string;
  cognitive_distortion?: string;
  content?: string;
  items?: string[];
  skill_id?: string;
  skill_name?: string;
  session_duration_min?: number | null;
  custom_metrics?: Record<string, string | number>;
  what_worked?: string;
  what_to_improve?: string;
  habit_id?: string;
  habit_name?: string;
  habit_completed?: boolean | null;
  habit_value?: number | null;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  waist_cm?: number | null;
  resting_hr?: number | null;
  meal_type?: string;
  foods?: string[];
  calories_estimate?: number | null;
  protein_estimate?: number | null;
  name?: string;
  dose?: number | null;
  unit?: string;
  goal_title?: string;
  progress_pct?: number | null;
  status?: string;
  statement?: string;
  category?: string;
}

export type ChartKind = "trend" | "scatter" | "habit_heatmap" | "skill_bars";

export type ChartPeriod = "7d" | "30d" | "90d" | "1y";

export interface ChartSpec {
  kind: ChartKind;
  metric?: string;
  period?: ChartPeriod;
  x?: string;
  y?: string;
  habit_id?: string;
  skill_id?: string;
  title?: string;
}

export type ChatRole = "user" | "assistant";

export interface ThreadMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: number;
  /** User message this assistant turn is answering. */
  source_user_turn_id?: string;
  proposals?: ProposedEntry[];
  life_proposals?: LifeProposal[];
  charts?: ChartSpec[];
  committed_ids?: string[];
  tools?: { name: string; status: "running" | "done" | "error"; detail?: string }[];
  context_audit?: {
    policy: ContextPolicy;
    unique_decrypted: number;
    sent_plaintext_to_model: boolean;
    tools: {
      name: string;
      entry_ids: string[];
      decrypted_ids: string[];
      approx_chars: number;
      truncated: boolean;
    }[];
  };
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
