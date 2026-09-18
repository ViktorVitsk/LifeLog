import { completeChat } from "./providers";
import { toolsForProvider } from "./schemas";
import { buildTodaySnapshot } from "./snapshot";
import { commitProposedEntry, normalizeProposal } from "./commit";
import { executeTool, extractFallbackProposals, type ToolRuntime } from "./tools";
import type { AppLocale } from "../i18n/locale";
import type { ChatCompletionMessage, ChartSpec, LlmSettings, ProposedEntry, ToolCall } from "./types";

function markTool(
  trace: AgentRunResult["tools"],
  name: string,
  status: "done" | "error",
  detail?: string,
) {
  for (let i = trace.length - 1; i >= 0; i--) {
    if (trace[i].name === name && trace[i].status === "running") {
      trace[i] = { name, status, detail };
      return;
    }
  }
}

function buildSystemPrompt(locale: AppLocale): string {
  const language =
    locale === "ru"
      ? `CRITICAL LANGUAGE RULE:
- The UI language is Russian (ru).
- EVERY assistant message the user sees MUST be in Russian.
- Never reply in English. Do not mix English sentences into the reply.
- Tool names and JSON keys stay in English. User-facing text is Russian.
Отвечай только по-русски.`
      : `Reply in English.`;

  const examples =
    locale === "ru"
      ? `Примеры вопросов: «Сколько часов спал?» «Настроение от 0 до 10?» «Это новая привычка „бег“, или одна из существующих: …?»`
      : `Example questions: "How many hours did you sleep?" "Mood 0–10?" "Which habit — done or not?"`;

  return `${language}

You are LifeLog, a personal capture agent. Work in CHAT INTERVIEW mode.

Goal: turn messy speech/text into structured diary entries. First pull the missing facts by asking short questions in chat, then call propose_entries.

Interview:
1. Infer the intended entry type: SLEEP, DAILY_CHECKIN, EMOTIONAL_STATE, HABIT_LOG, SKILL_SESSION, GRATITUDE, THOUGHT, MEAL, BODY_METRICS, SUPPLEMENT, GOAL_UPDATE, BELIEF.
2. If the last user message does not contain enough facts, do NOT call any tool. Ask ONE short question for the next most important field.
3. Never invent numeric scores (mood, energy, sleep hours, quality, etc.). If they did not state a number, ask or leave null. agent_inferred numbers must not auto_commit.
4. When you have enough to log, call propose_entries. The UI shows confirm cards. Do not claim data is saved unless commit_entries succeeded.
5. One conversation may yield several entry types. After a card, you may ask if they want to log something else.
6. Charts: call show_chart; never draw ASCII graphs.
7. Keep questions to one sentence. After proposing cards, one sentence is enough.
8. Match existing skill/habit names from the snapshot.
9. HABIT_LOG / SKILL_SESSION: if the name is not clearly one of the snapshot habits/skills, do NOT propose yet. Ask one question: is this a NEW item to create, or which existing one to log against (list names). If they confirm it is new, call create_habit or create_skill FIRST, use the returned id, THEN propose_entries. If they pick an existing one, set habit_id / skill_id from the snapshot.

Enough-to-propose:
- SLEEP: sleep_hours OR bedtime+wake_time; quality 0–10 if they have it
- DAILY_CHECKIN: mood_score and/or notes (energy/anxiety optional)
- EMOTIONAL_STATE: which feeling + score or gap text
- HABIT_LOG: completed yes/no AND either an existing habit_id or the user confirmed creating a new habit
- SKILL_SESSION: duration or notes AND either an existing skill_id or the user confirmed creating a new skill
- GRATITUDE: at least one item
- THOUGHT / BELIEF / GOAL_UPDATE: the text
- MEAL: what they ate
- BODY_METRICS: at least one number they stated
- SUPPLEMENT: name

${examples}`;
}

export interface AgentRunResult {
  assistantText: string;
  proposals: ProposedEntry[];
  charts: ChartSpec[];
  committedIds: string[];
  tools: { name: string; status: "running" | "done" | "error"; detail?: string }[];
}

export async function runAgent(args: {
  settings: LlmSettings;
  locale: AppLocale;
  history: ChatCompletionMessage[];
  userText: string;
  rt: ToolRuntime;
  onDelta?: (text: string) => void;
  onTool?: (name: string, status: "running" | "done" | "error", detail?: string) => void;
  signal?: AbortSignal;
}): Promise<AgentRunResult> {
  const snapshot = buildTodaySnapshot({
    entries: args.rt.entries,
    skills: args.rt.skills,
    habits: args.rt.habits,
    locale: args.locale,
  });
  const tools = toolsForProvider(args.settings.provider);
  const messages: ChatCompletionMessage[] = [
    {
      role: "system",
      content: `${buildSystemPrompt(args.locale)}\n\nToday snapshot (open metrics only):\n${JSON.stringify(snapshot)}`,
    },
    ...args.history,
    { role: "user", content: args.userText },
  ];

  const stream = args.settings.provider === "openrouter";
  let assistantText = "";
  const toolTrace: AgentRunResult["tools"] = [];

  for (let round = 0; round < 6; round++) {
    const result = await completeChat({
      settings: args.settings,
      messages,
      tools,
      stream,
      signal: args.signal,
      onDelta: args.onDelta,
    });
    assistantText += result.content || "";

    let calls: ToolCall[] = result.tool_calls;
    if (calls.length === 0 && round === 0) {
      const fallback = extractFallbackProposals(result.content || "");
      if (fallback.length) {
        calls = [
          {
            id: crypto.randomUUID(),
            type: "function",
            function: {
              name: "propose_entries",
              arguments: JSON.stringify({ entries: fallback }),
            },
          },
        ];
      }
    }

    if (calls.length === 0) break;

    messages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function.name;
      args.onTool?.(name, "running");
      toolTrace.push({ name, status: "running" });
      try {
        const out = await executeTool(name, call.function.arguments, args.rt);
        markTool(toolTrace, name, "done");
        args.onTool?.(name, "done");
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(out),
        });
      } catch (e) {
        const msg = (e as Error).message;
        markTool(toolTrace, name, "error", msg);
        args.onTool?.(name, "error", msg);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: msg }),
        });
      }
    }
  }

  // Auto-commit only explicit user_stated/extracted with auto_commit.
  const committedIds: string[] = [];
  for (const p of args.rt.proposals.values()) {
    if (!p.auto_commit) continue;
    if (p.provenance === "agent_inferred") continue;
    try {
      const res = await commitProposedEntry(p, args.rt.kek, {
        source_turn_id: args.rt.sourceTurnId,
        user_confirmed: true,
      });
      committedIds.push(res.id);
      args.rt.proposals.delete(p.id);
    } catch {
      /* leave as card */
    }
  }

  if (args.rt.proposals.size === 0 && assistantText.trim()) {
    const extra = extractFallbackProposals(assistantText);
    for (const item of extra) {
      const p = normalizeProposal(item, args.rt.skills, args.rt.habits);
      if (p) args.rt.proposals.set(p.id, p);
    }
  }

  return {
    assistantText: assistantText.trim(),
    proposals: [...args.rt.proposals.values()],
    charts: args.rt.charts,
    committedIds,
    tools: toolTrace,
  };
}
