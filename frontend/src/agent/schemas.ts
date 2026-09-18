import type { ToolDef } from "./types";

const proposedEntryProperties: Record<string, unknown> = {
  entry_type: {
    type: "string",
    enum: [
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
    ],
  },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  provenance: {
    type: "string",
    enum: ["user_stated", "agent_extracted", "agent_inferred"],
  },
  auto_commit: {
    type: "boolean",
    description: "Ignored. The app never persists from this flag.",
  },
  reason: { type: "string" },
  tags: { type: "array", items: { type: "string" } },
  timestamp: { type: "string", description: "ISO UTC if not now" },
  time_of_day: { type: "string", enum: ["morning", "afternoon", "evening"] },
  mood_score: { type: ["number", "null"] },
  energy_score: { type: ["number", "null"] },
  anxiety_score: { type: ["number", "null"] },
  focus_score: { type: ["number", "null"] },
  social_battery_score: { type: ["number", "null"] },
  stress_score: { type: ["number", "null"] },
  notes: { type: "string" },
  sleep_hours: { type: ["number", "null"] },
  sleep_quality: { type: ["number", "null"] },
  bedtime: { type: "string" },
  wake_time: { type: "string" },
  dream_notes: { type: "string" },
  resentment_score: { type: ["number", "null"] },
  guilt_score: { type: ["number", "null"] },
  shame_score: { type: ["number", "null"] },
  fear_score: { type: ["number", "null"] },
  resentment: { type: "object" },
  guilt: { type: "object" },
  shame: { type: "object" },
  fear: { type: "object" },
  reflection: { type: "string" },
  cognitive_distortion: { type: "string" },
  content: { type: "string" },
  items: { type: "array", items: { type: "string" } },
  skill_id: { type: "string" },
  skill_name: { type: "string" },
  session_duration_min: { type: ["number", "null"] },
  custom_metrics: { type: "object" },
  what_worked: { type: "string" },
  what_to_improve: { type: "string" },
  habit_id: { type: "string" },
  habit_name: { type: "string" },
  habit_completed: { type: ["boolean", "null"] },
  habit_value: { type: ["number", "null"] },
  weight_kg: { type: ["number", "null"] },
  body_fat_pct: { type: ["number", "null"] },
  waist_cm: { type: ["number", "null"] },
  resting_hr: { type: ["number", "null"] },
  meal_type: { type: "string" },
  foods: { type: "array", items: { type: "string" } },
  calories_estimate: { type: ["number", "null"] },
  protein_estimate: { type: ["number", "null"] },
  name: { type: "string" },
  dose: { type: ["number", "null"] },
  unit: { type: "string" },
  goal_title: { type: "string" },
  progress_pct: { type: ["number", "null"] },
  status: { type: "string" },
  statement: { type: "string" },
  category: { type: "string" },
};

const proposeEntries: ToolDef = {
  type: "function",
  function: {
    name: "propose_entries",
    description:
      "Propose structured log entries for confirm cards. Never persist. For HABIT_LOG / SKILL_SESSION include habit_id or skill_id from the snapshot, or a name so the user can confirm creating it on Save. Never invent numeric scores the user did not state. Out-of-range numbers are rejected, not clamped.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["entries"],
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            required: ["entry_type", "confidence", "provenance"],
            properties: proposedEntryProperties,
          },
        },
      },
    },
  },
};

const commitEntries: ToolDef = {
  type: "function",
  function: {
    name: "commit_entries",
    description:
      "Persist previously proposed entries (by id) after the user explicitly asked to save. Do not commit inferred scores.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["ids"],
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const getTodaySnapshot: ToolDef = {
  type: "function",
  function: {
    name: "get_today_snapshot",
    description:
      "Open metrics for today, active skills/habits, and missing logs (no LLM-needed numbers).",
    parameters: { type: "object", properties: {} },
  },
};

const searchEntries: ToolDef = {
  type: "function",
  function: {
    name: "search_entries",
    description:
      "Filter entries in the allowed context window by type/tag/date. Decrypts journal text only if policy allows and the per-run unique budget remains.",
    parameters: {
      type: "object",
      properties: {
        entry_type: { type: "string" },
        tag: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        decrypt: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
};

const showChart: ToolDef = {
  type: "function",
  function: {
    name: "show_chart",
    description: "Render a chart widget in the chat from open numeric metrics.",
    parameters: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["trend", "scatter", "habit_heatmap", "skill_bars"],
        },
        metric: { type: "string" },
        period: { type: "string", enum: ["7d", "30d", "90d", "1y"] },
        x: { type: "string" },
        y: { type: "string" },
        habit_id: { type: "string" },
        habit_name: { type: "string" },
        skill_id: { type: "string" },
        skill_name: { type: "string" },
        title: { type: "string" },
      },
    },
  },
};

const pinChart: ToolDef = {
  type: "function",
  function: {
    name: "pin_chart",
    description: "Pin a chart spec to the Today briefing.",
    parameters: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["trend", "scatter", "habit_heatmap", "skill_bars"],
        },
        metric: { type: "string" },
        period: { type: "string", enum: ["7d", "30d", "90d", "1y"] },
        x: { type: "string" },
        y: { type: "string" },
        habit_id: { type: "string" },
        skill_id: { type: "string" },
        title: { type: "string" },
      },
    },
  },
};

const listSkills: ToolDef = {
  type: "function",
  function: {
    name: "list_skills",
    description: "List the user's skills and metric schemas.",
    parameters: { type: "object", properties: {} },
  },
};

const proposeMemory: ToolDef = {
  type: "function",
  function: {
    name: "propose_memory",
    description:
      "Propose a memory item card. Not persisted. User accept is agreement with the wording, not scientific proof.",
    parameters: {
      type: "object",
      required: ["kind", "statement"],
      properties: {
        kind: {
          type: "string",
          enum: ["preference", "context", "observed_pattern", "hypothesis"],
        },
        statement: { type: "string" },
        grounds: { type: "string" },
        entry_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const proposeAction: ToolDef = {
  type: "function",
  function: {
    name: "propose_action",
    description: "Propose a small experiment card linked to a goal. Not persisted until the user accepts.",
    parameters: {
      type: "object",
      required: ["goal_id", "proposal"],
      properties: {
        goal_id: { type: "string" },
        proposal: { type: "string" },
        grounds: { type: "string" },
        result_metric: { type: "string" },
      },
    },
  },
};

const listHabits: ToolDef = {
  type: "function",
  function: {
    name: "list_habits",
    description: "List the user's habits.",
    parameters: { type: "object", properties: {} },
  },
};

const createSkill: ToolDef = {
  type: "function",
  function: {
    name: "create_skill",
    description:
      "Create a NEW skill after the user confirmed it is not an existing one. Then propose SKILL_SESSION with the returned id.",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        color: { type: "string" },
        icon: { type: "string" },
      },
    },
  },
};

const createHabit: ToolDef = {
  type: "function",
  function: {
    name: "create_habit",
    description:
      "Create a NEW habit after the user confirmed it is not an existing one. Then propose HABIT_LOG with the returned id.",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        frequency: { type: "string", enum: ["daily", "weekly"] },
        target_value: { type: "number" },
        unit: { type: "string" },
        color: { type: "string" },
      },
    },
  },
};

const updateHabit: ToolDef = {
  type: "function",
  function: {
    name: "update_habit",
    description: "Update or deactivate a habit.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        is_active: { type: "boolean" },
        target_value: { type: "number" },
        unit: { type: "string" },
      },
    },
  },
};

export const LOCAL_TOOLS: ToolDef[] = [
  getTodaySnapshot,
  proposeEntries,
  showChart,
  searchEntries,
  proposeMemory,
  proposeAction,
];

export const CLOUD_TOOLS: ToolDef[] = [
  getTodaySnapshot,
  searchEntries,
  listSkills,
  listHabits,
  proposeEntries,
  showChart,
  pinChart,
  proposeMemory,
  proposeAction,
];

/** Kept for runtime validation if a model still names a write tool. Not offered to the provider. */
export const BLOCKED_WRITE_TOOL_DEFS: ToolDef[] = [createSkill, createHabit, updateHabit, commitEntries];

export function toolsForProvider(provider: "openrouter" | "ollama"): ToolDef[] {
  return provider === "ollama" ? LOCAL_TOOLS : CLOUD_TOOLS;
}
