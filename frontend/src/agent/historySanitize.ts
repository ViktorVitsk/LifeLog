import type { ChatCompletionMessage, ContextPolicy } from "./types.ts";

/** Drop a trailing user turn that runAgent will add again. */
export function withoutDuplicateUser(history: ChatCompletionMessage[], userText: string): ChatCompletionMessage[] {
  const last = history[history.length - 1];
  if (last?.role === "user" && last.content === userText) return history.slice(0, -1);
  return history;
}

/**
 * A stricter policy must not silently re-send previously revealed diary/life
 * text that may sit in older assistant replies. Keep user questions only.
 */
export function historyForPolicy(
  history: ChatCompletionMessage[],
  policy: ContextPolicy,
  userText: string,
): ChatCompletionMessage[] {
  const base = withoutDuplicateUser(history, userText);
  if (policy === "decrypt_n") return base.slice(-16);
  return base.filter((m) => m.role === "user").slice(-8);
}
