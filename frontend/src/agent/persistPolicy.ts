/** Tools that would persist or mutate catalog. The model may name them; the app must not execute them. */
export const MODEL_WRITE_TOOLS = [
  "commit_entries",
  "create_skill",
  "create_habit",
  "update_habit",
] as const;

export type ModelWriteTool = (typeof MODEL_WRITE_TOOLS)[number];

export function isModelWriteTool(name: string): name is ModelWriteTool {
  return (MODEL_WRITE_TOOLS as readonly string[]).includes(name);
}

export function modelWriteBlockedResult(name: string): {
  error: "persist_requires_user_confirmation";
  tool: string;
  hint: string;
} {
  return {
    error: "persist_requires_user_confirmation",
    tool: name,
    hint: "Show confirm cards. Persistence and catalog changes happen only after the user taps Save.",
  };
}
