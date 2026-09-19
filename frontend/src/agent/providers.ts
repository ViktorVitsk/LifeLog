import type { ChatCompletionMessage, LlmSettings, ToolCall, ToolDef } from "./types.ts";
import { defaultSyntheticHandler } from "./syntheticScript.ts";

export interface ChatChunk {
  content?: string;
  tool_calls?: PartialToolCall[];
  finish_reason?: string | null;
}

export interface PartialToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export type SyntheticChatHandler = (args: {
  settings: LlmSettings;
  messages: ChatCompletionMessage[];
  tools: ToolDef[];
  stream: boolean;
}) => Promise<{ content: string; tool_calls: ToolCall[] }> | { content: string; tool_calls: ToolCall[] };

let syntheticHandler: SyntheticChatHandler | null = null;

export function setSyntheticChatHandler(handler: SyntheticChatHandler | null): void {
  syntheticHandler = handler;
}

export function getSyntheticChatHandler(): SyntheticChatHandler | null {
  return syntheticHandler;
}

export async function completeChat(args: {
  settings: LlmSettings;
  messages: ChatCompletionMessage[];
  tools: ToolDef[];
  stream: boolean;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<{ content: string; tool_calls: ToolCall[] }> {
  if (args.settings.provider === "synthetic") {
    const handler = syntheticHandler ?? defaultSyntheticHandler;
    const out = await handler({
      settings: args.settings,
      messages: args.messages,
      tools: args.tools,
      stream: args.stream,
    });
    if (out.content && args.onDelta) args.onDelta(out.content);
    return { content: out.content ?? "", tool_calls: out.tool_calls ?? [] };
  }

  const url = `${args.settings.base_url.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (args.settings.provider === "openrouter") {
    if (!args.settings.api_key.trim()) throw new Error("Add an OpenRouter API key in Settings.");
    headers.Authorization = `Bearer ${args.settings.api_key.trim()}`;
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "LifeLog";
  } else {
    headers.Authorization = "Bearer ollama";
  }

  const body = {
    model: args.settings.model,
    messages: args.messages,
    tools: args.tools,
    tool_choice: "auto" as const,
    temperature: 0.3,
    stream: args.stream,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: args.signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${t.slice(0, 280)}`);
  }

  if (!args.stream) {
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    };
    const msg = json.choices?.[0]?.message;
    return {
      content: msg?.content ?? "",
      tool_calls: msg?.tool_calls ?? [],
    };
  }

  if (!res.body) throw new Error("LLM stream had no body");
  return readOpenAiStream(res.body, args.onDelta);
}

async function readOpenAiStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (text: string) => void,
): Promise<{ content: string; tool_calls: ToolCall[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const tools = new Map<number, { id: string; name: string; args: string }>();

  const applyDelta = (chunk: ChatChunk) => {
    if (chunk.content) {
      content += chunk.content;
      onDelta?.(chunk.content);
    }
    for (const tc of chunk.tool_calls ?? []) {
      const cur = tools.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      tools.set(tc.index, cur);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string; tool_calls?: PartialToolCall[] } }[];
        };
        const delta = json.choices?.[0]?.delta;
        if (delta) applyDelta({ content: delta.content, tool_calls: delta.tool_calls });
      } catch {
        /* ignore malformed sse */
      }
    }
  }

  const tool_calls: ToolCall[] = [...tools.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, t]) => t.name)
    .map(([, t]) => ({
      id: t.id || crypto.randomUUID(),
      type: "function",
      function: { name: t.name, arguments: t.args || "{}" },
    }));

  return { content, tool_calls };
}
