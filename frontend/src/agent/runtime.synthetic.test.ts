import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { webcrypto } from "node:crypto";
import { deriveKEK, encryptEntry } from "../lib/crypto.ts";
import { runAgent } from "./runtime.ts";
import { setSyntheticChatHandler } from "./providers.ts";
import { resolveContextEnvelope } from "./contextEnvelope.ts";
import type { ToolRuntime } from "./tools.ts";
import type { LlmSettings } from "./types.ts";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const SALT = "ab".repeat(16);
const GOAL_ID = "11111111-1111-4111-8111-111111111111";
const MEM_ID = "22222222-2222-4222-8222-222222222222";

function settings(): LlmSettings {
  return {
    provider: "synthetic",
    model: "script",
    base_url: "synthetic://local",
    context_policy: "decrypt_n",
    decrypt_n: 5,
    api_key: "",
  };
}

describe("runAgent synthetic personal context", () => {
  afterEach(() => setSyntheticChatHandler(null));

  it("sends accepted memory and lets propose_action use a real goal id", async () => {
    const kek = await deriveKEK("testdata1", SALT);
    const mem = await encryptEntry(JSON.stringify({ statement: "I prefer evening logs" }), kek);
    const goal = await encryptEntry(JSON.stringify({ title: "Sleep earlier" }), kek);
    let sawAccepted = false;
    let sawDisputed = false;
    let rounds = 0;
    setSyntheticChatHandler((args) => {
      const blob = JSON.stringify(args.messages);
      sawAccepted = blob.includes("I prefer evening logs");
      sawDisputed = blob.includes("secret disputed");
      assert.ok(args.tools.some((t) => t.function.name === "propose_action"));
      if (rounds++ > 0) return { content: "", tool_calls: [] };
      return {
        content: "proposed",
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: {
              name: "propose_action",
              arguments: JSON.stringify({
                goal_id: GOAL_ID,
                proposal: "Lights out at 23:00",
                grounds: "memory",
                result_metric: "bedtime",
              }),
            },
          },
        ],
      };
    });

    const envelope = resolveContextEnvelope(settings());
    const rt: ToolRuntime = {
      kek,
      token: "t",
      entries: [],
      skills: [],
      habits: [],
      settings: settings(),
      locale: "en",
      sourceTurnId: "u1",
      proposals: new Map(),
      charts: [],
      envelope,
      budget: { envelope, decryptedEntryIds: new Set(), audit: [], provider: "synthetic" },
      mode: "analyze",
      lifeBundle: {
        goals: [
          {
            id: GOAL_ID,
            state: "active",
            encrypted_dek: goal.encryptedDek,
            encrypted_content: goal.encryptedContent,
            created_at: "t",
            updated_at: "t",
          },
        ],
        memory: [
          {
            id: MEM_ID,
            kind: "preference",
            state: "accepted",
            origin: "user",
            encrypted_dek: mem.encryptedDek,
            encrypted_content: mem.encryptedContent,
            created_at: "t",
            updated_at: "t",
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            kind: "hypothesis",
            state: "disputed",
            origin: "agent",
            encrypted_dek: mem.encryptedDek,
            encrypted_content: mem.encryptedContent,
            created_at: "t",
            updated_at: "t",
          },
        ],
        actions: [],
        feedback: [],
        due_action_ids: [],
      },
    };

    const result = await runAgent({
      settings: settings(),
      locale: "en",
      history: [],
      userText: "propose an action",
      rt,
      mode: "analyze",
    });

    assert.equal(sawAccepted, true);
    assert.equal(sawDisputed, false);
    assert.equal(result.lifeProposals.length, 1);
    assert.equal(result.lifeProposals[0].body.goal_id, GOAL_ID);
    assert.equal(typeof result.lifeProposals[0].body.review_at, "string");
  });

  it("omits goal plaintext under today policy", async () => {
    const kek = await deriveKEK("testdata1", SALT);
    const goal = await encryptEntry(JSON.stringify({ title: "HIDDEN_GOAL_TITLE" }), kek);
    let blob = "";
    setSyntheticChatHandler((args) => {
      blob = JSON.stringify(args.messages);
      return { content: "ok", tool_calls: [] };
    });
    const s: LlmSettings = { ...settings(), context_policy: "today" };
    const envelope = resolveContextEnvelope(s);
    const rt: ToolRuntime = {
      kek,
      token: "t",
      entries: [],
      skills: [],
      habits: [],
      settings: s,
      locale: "en",
      sourceTurnId: "u1",
      proposals: new Map(),
      charts: [],
      envelope,
      budget: { envelope, decryptedEntryIds: new Set(), audit: [], provider: "synthetic" },
      mode: "analyze",
      lifeBundle: {
        goals: [
          {
            id: GOAL_ID,
            state: "active",
            encrypted_dek: goal.encryptedDek,
            encrypted_content: goal.encryptedContent,
            created_at: "t",
            updated_at: "t",
          },
        ],
        memory: [],
        actions: [],
        feedback: [],
        due_action_ids: [],
      },
    };
    await runAgent({ settings: s, locale: "en", history: [], userText: "hi", rt, mode: "analyze" });
    assert.equal(blob.includes("HIDDEN_GOAL_TITLE"), false);
    assert.equal(blob.includes(GOAL_ID), true);
  });
});
