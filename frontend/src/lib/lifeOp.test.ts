import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { webcrypto } from "node:crypto";
import { installTestQueue, uninstallTestQueue } from "../db/testQueue.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";
import { deriveKEK } from "./crypto.ts";
import { ActionChangedError, commitFeedbackDecision, findOpenFeedbackOp, refreshLifeOpStatus } from "./lifeOp.ts";
import { applyLifeResult } from "./lifeQueue.ts";
import type { LifeActionRead } from "./api.ts";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const SALT = "ab".repeat(16);

function action(over: Partial<LifeActionRead> = {}): LifeActionRead {
  return {
    id: "a1",
    goal_id: "g1",
    state: "accepted",
    result_metric: null,
    period_start: null,
    period_end: null,
    review_at: "2026-09-26T12:00:00.000Z",
    encrypted_dek: "d",
    encrypted_content: "plan",
    version: 4,
    created_at: "2026-08-02T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

describe("durable feedback operation", () => {
  let kek: CryptoKey;
  before(async () => {
    kek = await deriveKEK("testdata1", SALT);
  });
  afterEach(() => {
    uninstallTestQueue();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("stores outcome and decision separately and reuses the same ids after a crash", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const fields = {
      what_changed: "экраны до 00:20",
      difficulty: "переписка",
      side_effects: "",
      observed_on: "2026-09-19",
    };
    await assert.rejects(
      () =>
        commitFeedbackDecision({
          kek,
          action: action(),
          outcome: "tried_no_effect",
          decision: "complete",
          fields,
          afterLocal: async () => {
            throw new Error("crash_after_local");
          },
        }),
      /crash_after_local/,
    );
    const feedbackRows = [...store.life.values()].filter((row) => row.kind === "feedback");
    const actionRow = store.life.get("a1");
    assert.equal(feedbackRows.length, 1);
    assert.equal(feedbackRows[0].payload.outcome_kind, "tried_no_effect");
    assert.equal(actionRow?.payload.state, "completed");
    const firstId = feedbackRows[0].id;
    const cipher = String(feedbackRows[0].payload.encrypted_content);

    setCurrentUserId("u2");
    const open = await findOpenFeedbackOp("u1", "a1");
    assert.ok(open);
    assert.equal(open.owner_user_id, "u1");

    setCurrentUserId("u1");
    const retry = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_no_effect",
      decision: "complete",
      fields,
    });
    assert.equal(retry.reusedCipher, true);
    assert.equal(retry.op.feedback_id, firstId);
    assert.equal([...store.life.values()].filter((row) => row.kind === "feedback").length, 1);
    assert.equal(store.life.get(firstId)?.payload.encrypted_content, cipher);
  });

  it("keeps helped + stop when the user chose both explicitly", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "stop",
      fields: { what_changed: "уснул раньше", difficulty: "", side_effects: "", observed_on: "" },
    });
    assert.equal(store.life.get("a1")?.payload.state, "stopped");
    const fb = [...store.life.values()].find((row) => row.kind === "feedback");
    assert.equal(fb?.payload.outcome_kind, "tried_helped");
  });

  it("does not silently overwrite a newer remote action version", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    store.life.set("a1", {
      id: "a1",
      kind: "action",
      payload: { id: "a1", state: "accepted", version: 9, encrypted_content: "other-device", encrypted_dek: "d" },
      status: "synced",
      owner_user_id: "u1",
      queued_at: 1,
      server_version: 9,
    });
    await assert.rejects(
      () =>
        commitFeedbackDecision({
          kek,
          action: action({ version: 4 }),
          outcome: "unevaluated",
          decision: "continue",
          fields: { what_changed: "пока рано судить", difficulty: "", side_effects: "", observed_on: "" },
        }),
      ActionChangedError,
    );
    assert.equal(store.life.get("a1")?.payload.encrypted_content, "other-device");
    assert.equal([...store.life.values()].filter((row) => row.kind === "feedback").length, 0);
  });

  it("marks a partial ack so reload can finish the action half", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "unevaluated",
      decision: "continue",
      fields: { what_changed: "ещё неясно", difficulty: "", side_effects: "", observed_on: "" },
    });
    await applyLifeResult(
      {
        id: op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: 1,
        payload: store.life.get(op.feedback_id)!.payload,
        status: "pending",
      },
      { status: "created", version: 1 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal(store.ops.get(op.id)?.status, "feedback_acked");
    assert.equal(store.life.get("a1")?.status, "pending");
    assert.equal(store.life.get(op.feedback_id)?.status, "synced");
  });
});
