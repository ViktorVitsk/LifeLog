import type { ChatCompletionMessage, ToolCall, ToolDef } from "./types.ts";

function lastUserText(messages: ChatCompletionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content) return String(messages[i].content);
  }
  return "";
}

function systemBlob(messages: ChatCompletionMessage[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .join("\n");
}

function firstGoalId(blob: string): string | null {
  const block = blob.match(/"goals":\s*\[(.*?)\]/s);
  if (!block) return null;
  const id = block[1].match(/"id":\s*"([0-9a-f-]{36})"/i);
  return id?.[1] ?? null;
}

function firstEntryId(blob: string): string | null {
  const id = blob.match(/"id":\s*"([0-9a-f-]{36})"/i);
  return id?.[1] ?? null;
}

function hasTool(tools: ToolDef[], name: string): boolean {
  return tools.some((t) => t.function.name === name);
}

export function defaultSyntheticHandler(args: {
  messages: ChatCompletionMessage[];
  tools: ToolDef[];
}): { content: string; tool_calls: ToolCall[] } {
  const alreadyUsedTools = args.messages.some((m) => m.role === "tool" || Boolean(m.tool_calls?.length));
  const text = lastUserText(args.messages).toLowerCase();
  const blob = systemBlob(args.messages);
  const calls: ToolCall[] = [];
  if (alreadyUsedTools) {
    return {
      content: blob.includes("Deterministic review briefing")
        ? "Recorded: the briefing already lists observations, coverage, goals, and action results. A missing day is not a failure. Hypothesized: none."
        : "Карточки готовы. Ничего не сохранено, пока вы не подтвердите.",
      tool_calls: [],
    };
  }

  if (hasTool(args.tools, "propose_memory") && /памят|memory|запомни|remember/.test(text)) {
    calls.push({
      id: "syn-mem",
      type: "function",
      function: {
        name: "propose_memory",
        arguments: JSON.stringify({
          kind: "preference",
          statement: "Вечерние записи даются легче, чем утренние.",
          grounds: "user stated",
          entry_ids: firstEntryId(blob) ? [firstEntryId(blob)] : [],
        }),
      },
    });
  }

  if (hasTool(args.tools, "propose_action") && /действи|action|попробу|habit|цел/.test(text)) {
    const goalId = firstGoalId(blob);
    if (goalId) {
      calls.push({
        id: "syn-act",
        type: "function",
        function: {
          name: "propose_action",
          arguments: JSON.stringify({
            goal_id: goalId,
            proposal: "Лечь до 23:30 три вечера подряд",
            grounds: "accepted memory + selected goal",
            result_metric: "bedtime before 23:30",
          }),
        },
      });
    }
  }

  if (hasTool(args.tools, "propose_entries") && calls.length === 0 && /сон|sleep|настроен|thought|мысл/.test(text)) {
    calls.push({
      id: "syn-entry",
      type: "function",
      function: {
        name: "propose_entries",
        arguments: JSON.stringify({
          entries: [
            {
              entry_type: /сон|sleep/.test(text) ? "SLEEP" : "THOUGHT",
              confidence: 0.8,
              provenance: "user_stated",
              notes: lastUserText(args.messages),
              content: lastUserText(args.messages),
              sleep_hours: /сон|sleep/.test(text) ? 7.5 : undefined,
            },
          ],
        }),
      },
    });
  }

  const content = blob.includes("Deterministic review briefing")
    ? "Recorded: the briefing already lists observations, coverage, goals, and action results. A missing day is not a failure. Hypothesized: none."
    : calls.length
      ? "Проверьте карточки ниже."
      : "Записал. Если нужна память или действие — переключитесь в «Разобрать».";

  return { content, tool_calls: calls };
}
