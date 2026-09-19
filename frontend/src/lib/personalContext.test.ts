import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { webcrypto } from "node:crypto";
import { deriveKEK, encryptEntry } from "./crypto.ts";
import { assembleAllowedPersonalContext } from "./personalContext.ts";
import type { LifeBundle } from "./api.ts";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const SALT = "ab".repeat(16);

async function wrap(kek: CryptoKey, body: Record<string, unknown>) {
  const { encryptedContent, encryptedDek } = await encryptEntry(JSON.stringify(body), kek);
  return { encrypted_content: encryptedContent, encrypted_dek: encryptedDek };
}

describe("assembleAllowedPersonalContext", () => {
  let kek: CryptoKey;
  before(async () => {
    kek = await deriveKEK("testdata1", SALT);
  });
  after(() => undefined);

  async function bundle(): Promise<LifeBundle> {
    const accepted = await wrap(kek, { statement: "I prefer evening logs" });
    const disputed = await wrap(kek, { statement: "secret disputed" });
    const stale = await wrap(kek, { statement: "old stale" });
    const goal = await wrap(kek, { title: "Sleep earlier", why: "rest" });
    return {
      goals: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          state: "active",
          encrypted_dek: goal.encrypted_dek,
          encrypted_content: goal.encrypted_content,
          created_at: "t",
          updated_at: "t",
        },
      ],
      memory: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "preference",
          state: "accepted",
          origin: "user",
          encrypted_dek: accepted.encrypted_dek,
          encrypted_content: accepted.encrypted_content,
          created_at: "t",
          updated_at: "t",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "hypothesis",
          state: "disputed",
          origin: "agent",
          encrypted_dek: disputed.encrypted_dek,
          encrypted_content: disputed.encrypted_content,
          created_at: "t",
          updated_at: "t",
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          kind: "preference",
          state: "stale",
          origin: "user",
          encrypted_dek: stale.encrypted_dek,
          encrypted_content: stale.encrypted_content,
          created_at: "t",
          updated_at: "t",
        },
      ],
      actions: [],
      feedback: [],
      due_action_ids: [],
    };
  }

  it("includes accepted memory plaintext only under decrypt_n", async () => {
    const life = await bundle();
    const open = await assembleAllowedPersonalContext({
      bundle: life,
      entries: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }],
      policy: "today",
      kek,
    });
    assert.equal(open.sent.memory.length, 1);
    assert.equal(open.sent.memory[0].id, "22222222-2222-4222-8222-222222222222");
    assert.equal(open.sent.memory[0].statement, undefined);
    assert.equal(open.promptBlock.includes("I prefer evening logs"), false);
    assert.equal(open.promptBlock.includes("secret disputed"), false);
    assert.equal(open.ids.goals.has("11111111-1111-4111-8111-111111111111"), true);

    const plain = await assembleAllowedPersonalContext({
      bundle: life,
      entries: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }],
      policy: "decrypt_n",
      kek,
      decryptLimit: 5,
    });
    assert.equal(plain.sent.memory[0].statement, "I prefer evening logs");
    assert.equal(plain.sent.goals[0].title, "Sleep earlier");
    assert.equal(plain.promptBlock.includes("secret disputed"), false);
    assert.equal(plain.promptBlock.includes("old stale"), false);
    assert.equal(plain.ids.memory.has("33333333-3333-4333-8333-333333333333"), false);
  });
});
