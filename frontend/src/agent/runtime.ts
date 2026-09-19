import { completeChat } from "./providers.ts";
import { buildTodaySnapshot } from "./snapshot.ts";
import { normalizeProposal } from "./normalizeProposal.ts";
import {
  filterEntriesForPolicy,
  finishRunAudit,
  policyPromptLine,
  resolveContextEnvelope,
  type ContextBudget,
} from "./contextEnvelope.ts";
import { executeTool, extractFallbackProposals, type ToolRuntime } from "./tools.ts";
import type { AppLocale } from "../i18n/locale.ts";
import type { ChatCompletionMessage, ChartSpec, ChatMode, LifeProposal, LlmSettings, ProposedEntry, ToolCall } from "./types.ts";
import type { RunContextAudit } from "./contextEnvelope.ts";
import { buildReviewBriefing, modeSystemPrompt, stripUnknownIds, toolsForMode } from "./modes.ts";
import { assembleAllowedPersonalContext } from "../lib/personalContext.ts";
import { getAccountTimeZone, startOfLocalDay } from "../lib/dates.ts";

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
  const personal = await assembleAllowedPersonalContext({
    bundle: args.rt.lifeBundle,
    entries: scoped,
    policy: envelope.policy,
    kek: args.rt.kek,
    decryptLimit: args.settings.decrypt_n,
  });
  const known = new Set<string>([
    ...personal.allIds,
    ...args.rt.skills.map((s) => s.id),
    ...args.rt.habits.map((h) => h.id),
  ]);
  args.rt.knownIds = known;
  args.rt.typedIds = personal.ids;
  const tools = toolsForMode(args.settings.provider, mode);
  const policy = policyPromptLine(envelope, args.locale === "en" ? "en" : "ru");
  const period = args.rt.reviewPeriod ?? "1d";
  const tz = getAccountTimeZone();
  const todayStart = startOfLocalDay(envelope.windowEnd, tz);
  const periodStart =
    period === "1d"
      ? todayStart
      : period === "7d"
        ? new Date(todayStart.getTime() - 6 * 24 * 3600_000)
        : envelope.windowStart;
  const windowStart = new Date(Math.max(periodStart.getTime(), envelope.windowStart.getTime()));
  const periodEntries = scoped.filter((e) => {
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && t >= windowStart.getTime() && t <= envelope.windowEnd.getTime();
  });
  const briefing =
    mode === "review"
      ? buildReviewBriefing({
          localDay: snapshot.local_day,
          snapshot,
          dueActionIds: args.rt.dueActionIds ?? args.rt.lifeBundle?.due_action_ids ?? [],
          periodLabel: period === "1d" ? snapshot.local_day : period,
          period,
          windowStart: windowStart.toISOString(),
          windowEnd: envelope.windowEnd.toISOString(),
          entries: periodEntries.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            entry_type: e.entry_type,
            mood_score: e.mood_score,
          })),
          goals: personal.sent.goals.map((g) => ({
            id: String(g.id),
            state: String(g.state ?? ""),
            title: typeof g.title === "string" ? g.title : undefined,
          })),
          actions: personal.sent.actions.map((a) => ({
            id: String(a.id),
            state: String(a.state ?? ""),
            goal_id: typeof a.goal_id === "string" ? a.goal_id : undefined,
            result_metric: typeof a.result_metric === "string" ? a.result_metric : null,
            review_at: typeof a.review_at === "string" ? a.review_at : null,
          })),
          feedback: (args.rt.lifeBundle?.feedback ?? []).map((f) => ({
            action_id: f.action_id,
            outcome_kind: f.outcome_kind,
          })),
        })
      : null;
  const messages: ChatCompletionMessage[] = [
    {
      role: "system",
      content: `${buildSystemPrompt(args.locale, mode)}\n\n${policy}\n\nToday snapshot (open metrics only):\n${JSON.stringify(snapshot)}\n\nAllowed personal context (cite only these ids):\n${personal.promptBlock}${
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

  const audit = finishRunAudit(args.rt.budget);
  if (personal.sentPlaintext) audit.sent_plaintext_to_model = true;
  return {
    assistantText: stripUnknownIds(assistantText.trim(), personal.allIds),
    proposals: [...args.rt.proposals.values()],
    lifeProposals: args.rt.lifeProposals ?? [],
    charts: args.rt.charts,
    committedIds: [],
    tools: toolTrace,
    contextAudit: audit,
  };
}
