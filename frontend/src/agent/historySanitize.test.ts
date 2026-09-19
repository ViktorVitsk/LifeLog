import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { historyForPolicy, withoutDuplicateUser } from "./historySanitize.ts";

describe("history sanitize", () => {
  it("drops a trailing user turn that runAgent will add again", () => {
    const history = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "ok" },
      { role: "user" as const, content: "again" },
    ];
    const out = withoutDuplicateUser(history, "again");
    assert.equal(out.length, 2);
    assert.equal(out[1].role, "assistant");
  });

  it("does not resend assistant plaintext when policy becomes stricter", () => {
    const history = [
      { role: "user" as const, content: "what did I write?" },
      { role: "assistant" as const, content: "You wrote SECRET_DIARY_TEXT about sleep." },
      { role: "user" as const, content: "and now?" },
    ];
    const strict = historyForPolicy(history, "today", "and now?");
    assert.equal(strict.every((m) => m.role === "user"), true);
    assert.equal(JSON.stringify(strict).includes("SECRET_DIARY_TEXT"), false);
    const open = historyForPolicy(history, "decrypt_n", "and now?");
    assert.ok(JSON.stringify(open).includes("SECRET_DIARY_TEXT"));
  });
});
