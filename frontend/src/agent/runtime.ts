import { completeChat } from "./providers";
import { buildTodaySnapshot } from "./snapshot";
import { normalizeProposal } from "./normalizeProposal";
import {
  filterEntriesForPolicy,
  finishRunAudit,
  policyPromptLine,
  resolveContextEnvelope,
  type ContextBudget,
} from "./contextEnvelope";
import { executeTool, extractFallbackProposals, type ToolRuntime } from "./tools";
import type { AppLocale } from "../i18n/locale";
import type { ChatCompletionMessage, ChartSpec, ChatMode, LifeProposal, LlmSettings, ProposedEntry, ToolCall } from "./types";
import type { RunContextAudit } from "./contextEnvelope";
import { buildReviewBriefing, modeSystemPrompt, stripUnknownIds, toolsForMode } from "./modes";

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

function buildSystemPrompt(locale: AppLocale, mode: ChatMode): string {
  return modeSystemPrompt(mode, locale);
}

export interface AgentRunResult {
  assistantText: string;
  proposals: ProposedEntry[];
  lifeProposals: LifeProposal[];
  charts: ChartSpec[];
  committedIds: string[];
  tools: { name: string; status: "running" | "done" | "error"; detail?: string }[];
  contextAudit: RunContextAudit;
}

export function ensureAgentBudget(rt: ToolRuntime, settings: LlmSettings): ContextBudget {
  if (rt.budget) return rt.budget;
  const envelope = resolveContextEnvelope(settings);
  const budget: ContextBudget = {
    envelope,
    decryptedEntryIds: new Set(),
    audit: [],
    provider: settings.provider,
  };
  rt.envelope = envelope;
  rt.budget = budget;
  return budget;
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
  mode?: ChatMode;
}): Promise<AgentRunResult> {
  const envelope = args.rt.envelope ?? resolveContextEnvelope(args.settings);
  args.rt.envelope = envelope;
  if (!args.rt.budget) {
    args.rt.budget = {
      envelope,
      decryptedEntryIds: new Set(),
      audit: [],
      provider: args.settings.provider,
    };
  }

  const mode = args.mode ?? args.rt.mode ?? "record";
  args.rt.mode = mode;
  args.rt.allowedTools = new Set(toolsForMode(args.settings.provider, mode).map((tool) => tool.function.name));
  args.rt.lifeProposals = args.rt.lifeProposals ?? [];
  const scoped = filterEntriesForPolicy(args.rt.entries, envelope);
  const snapshot = buildTodaySnapshot({
    entries: scoped,
    skills: args.rt.skills,
    habits: args.rt.habits,
    locale: args.locale,
  });
  const known = new Set<string>([
    ...scoped.map((e) => e.id),
    ...args.rt.skills.map((s) => s.id),
    ...args.rt.habits.map((h) => h.id),
    ...(args.rt.knownIds ?? []),
  ]);
  args.rt.knownIds = known;
  const tools = toolsForMode(args.settings.provider, mode);
  const policy = policyPromptLine(envelope, args.locale === "en" ? "en" : "ru");
  const briefing =
    mode === "review"
      ? buildReviewBriefing({
          localDay: snapshot.local_day,
          snapshot,
          dueActionIds: args.rt.dueActionIds ?? [],
          periodLabel: snapshot.local_day,
        })
      : null;
  const messages: ChatCompletionMessage[] = [
    {
      role: "system",
      content: `${buildSystemPrompt(args.locale, mode)}\n\n${policy}\n\nToday snapshot (open metrics only):\n${JSON.stringify(snapshot)}${
        briefing ? `\n\nDeterministic review briefing:\n${JSON.stringify(briefing)}` : ""
      }`,
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

  if (args.rt.proposals.size === 0 && assistantText.trim()) {
    const extra = extractFallbackProposals(assistantText);
    for (const item of extra) {
      const p = normalizeProposal(item, args.rt.skills, args.rt.habits);
      if (p) {
        p.auto_commit = false;
        args.rt.proposals.set(p.id, p);
      }
    }
  }

  return {
    assistantText: stripUnknownIds(assistantText.trim(), args.rt.knownIds ?? []),
    proposals: [...args.rt.proposals.values()],
    lifeProposals: args.rt.lifeProposals ?? [],
    charts: args.rt.charts,
    committedIds: [],
    tools: toolTrace,
    contextAudit: finishRunAudit(args.rt.budget),
  };
}
