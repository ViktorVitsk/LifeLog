import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { webcrypto } from "node:crypto";
import { installTestQueue, uninstallTestQueue } from "../db/testQueue.ts";
import { migrateLifeOpRow } from "../db/offlineQueue.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";
import { deriveKEK } from "./crypto.ts";
import { intentKey } from "./feedbackOutcome.ts";
import {
  ActionChangedError,
  commitFeedbackCorrection,
  commitFeedbackDecision,
  findOpenFeedbackOp,
  refreshLifeOpStatus,
} from "./lifeOp.ts";
import { applyLifeResult, readLifeRow } from "./lifeQueue.ts";
import type { LifeActionRead, LifeFeedbackRead } from "./api.ts";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const SALT = "ab".repeat(16);
const MARK_WHAT = "H1_WHAT_qx91m";
const MARK_DIFF = "H1_DIFF_k3w8s";
const MARK_PLAN = "H1_PLAN_n7c2a";

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

function fields(over: Partial<{ what_changed: string; difficulty: string; side_effects: string; observed_on: string; plan_text?: string }> = {}) {
  return {
    what_changed: "экраны до 00:20",
    difficulty: "переписка",
    side_effects: "",
    observed_on: "2026-09-19",
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

  it("does not store plaintext markers in op or queue metadata", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_no_effect",
      decision: "complete",
      submissionId: "sub-plain",
      fields: fields({ what_changed: MARK_WHAT, difficulty: MARK_DIFF, plan_text: MARK_PLAN }),
      planSnapshot: MARK_PLAN,
    });
    const dumped = `${JSON.stringify(op)}\n${JSON.stringify([...store.ops.values()])}\n${JSON.stringify([...store.life.values()].map((row) => ({ id: row.id, kind: row.kind, status: row.status, payload: { ...row.payload, encrypted_content: "x", encrypted_dek: "y" } })))}`;
    assert.equal(dumped.includes(MARK_WHAT), false, dumped);
    assert.equal(dumped.includes(MARK_DIFF), false);
    assert.equal(dumped.includes(MARK_PLAN), false);
    assert.equal("intent_key" in op, false);
    assert.equal(op.submission_id, "sub-plain");
    const rawOp = JSON.stringify(store.ops.get(op.id));
    assert.equal(rawOp.includes(MARK_WHAT), false);
    assert.ok(String(op.feedback_payload?.encrypted_content ?? "").length > 8);
  });

  it("migrates a synthetic old row and keeps it deliverable", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const first = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "unevaluated",
      decision: "continue",
      submissionId: "legacy-sub",
      fields: fields({ what_changed: MARK_WHAT }),
    });
    const dirty = {
      ...first.op,
      intent_key: intentKey({
        outcome: "unevaluated",
        decision: "continue",
        what_changed: MARK_WHAT,
        difficulty: "",
        side_effects: "",
        observed_on: "2026-09-19",
        plan_text: "",
      }),
    };
    const migrated = migrateLifeOpRow(dirty as unknown as Record<string, unknown>);
    assert.equal(migrated.intent_key, undefined);
    assert.equal(migrated.submission_id, "legacy-sub");
    assert.equal(JSON.stringify(migrated).includes(MARK_WHAT), false);
    store.ops.set(first.op.id, migrated as typeof first.op);
    const retry = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "unevaluated",
      decision: "continue",
      submissionId: String(migrated.submission_id),
      fields: fields({ what_changed: MARK_WHAT }),
    });
    assert.equal(retry.op.feedback_id, first.op.feedback_id);
    assert.equal(retry.reusedCipher, true);
    assert.equal([...store.life.values()].filter((row) => row.kind === "feedback").length, 1);
  });

  it("stores outcome and decision separately and reuses the same ids after a crash", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const submissionId = "sub-crash";
    await assert.rejects(
      () =>
        commitFeedbackDecision({
          kek,
          action: action(),
          outcome: "tried_no_effect",
          decision: "complete",
          submissionId,
          fields: fields(),
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
      submissionId,
      fields: fields(),
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
      submissionId: "sub-stop",
      fields: fields({ what_changed: "уснул раньше", difficulty: "", observed_on: "" }),
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
          submissionId: "sub-ver",
          fields: fields({ what_changed: "пока рано судить", difficulty: "", observed_on: "" }),
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
      submissionId: "sub-partial",
      fields: fields({ what_changed: "ещё неясно", difficulty: "", observed_on: "" }),
    });
    await applyLifeResult(
      {
        id: op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: op.feedback_local_rev ?? 1,
        payload: store.life.get(op.feedback_id)!.payload,
        status: "pending",
      },
      { status: "created", version: 1 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal(store.ops.get(op.id)?.status, "feedback_acked");
    assert.equal(store.life.get("a1")?.status, "pending");
    assert.equal(store.life.get(op.feedback_id)?.status, "synced");
    assert.ok(store.ops.get(op.id)?.feedback_payload);
  });

  it("keeps one op for parallel commits of the same submission_id", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const submissionId = "sub-parallel";
    const body = {
      kek,
      action: action(),
      outcome: "tried_helped" as const,
      decision: "continue" as const,
      submissionId,
      fields: fields({ what_changed: "один клик" }),
    };
    const [a, b] = await Promise.all([commitFeedbackDecision(body), commitFeedbackDecision(body)]);
    assert.equal(a.op.id, b.op.id);
    assert.equal([...store.life.values()].filter((row) => row.kind === "feedback").length, 1);
    assert.equal([...store.ops.values()].filter((row) => row.status !== "superseded").length, 1);
  });

  it("creates two feedbacks for two submission ids", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "not_tried",
      decision: "continue",
      submissionId: "sub-a",
      fields: fields({ what_changed: "первое" }),
    });
    await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "continue",
      submissionId: "sub-b",
      fields: fields({ what_changed: "второе" }),
    });
    const feedbacks = [...store.life.values()].filter((row) => row.kind === "feedback");
    assert.equal(feedbacks.length, 2);
    const open = [...store.ops.values()].filter((row) => row.status !== "superseded" && row.status !== "done");
    const superseded = [...store.ops.values()].filter((row) => row.status === "superseded");
    assert.equal(open.length, 1);
    assert.equal(superseded.length, 1);
  });

  it("rejects a prepared payload if the action rev changes during encrypt", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    store.life.set("a1", {
      id: "a1",
      kind: "action",
      payload: { id: "a1", state: "accepted", version: 4, encrypted_content: "current", encrypted_dek: "d" },
      status: "synced",
      owner_user_id: "u1",
      queued_at: 1,
      local_rev: 2,
      server_version: 4,
    });
    await assert.rejects(
      () =>
        commitFeedbackDecision({
          kek,
          action: action({ version: 4 }),
          outcome: "unevaluated",
          decision: "continue",
          submissionId: "sub-race",
          fields: fields({ what_changed: "старый черновик" }),
          afterEncrypt: async () => {
            const row = store.life.get("a1")!;
            store.life.set("a1", {
              ...row,
              local_rev: (row.local_rev ?? 0) + 1,
              payload: { ...row.payload, encrypted_content: "newer" },
            });
          },
        }),
      ActionChangedError,
    );
    assert.equal(store.life.get("a1")?.payload.encrypted_content, "newer");
    assert.equal([...store.life.values()].filter((row) => row.kind === "feedback").length, 0);
  });

  it("rejects when the server version grows before the write transaction", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    store.life.set("a1", {
      id: "a1",
      kind: "action",
      payload: { id: "a1", state: "accepted", version: 4, encrypted_content: "v4", encrypted_dek: "d" },
      status: "synced",
      owner_user_id: "u1",
      queued_at: 1,
      local_rev: 1,
      server_version: 4,
    });
    await assert.rejects(
      () =>
        commitFeedbackDecision({
          kek,
          action: action({ version: 4 }),
          outcome: "unevaluated",
          decision: "continue",
          submissionId: "sub-cas",
          fields: fields({ what_changed: "кас" }),
          afterEncrypt: async () => {
            const row = store.life.get("a1")!;
            store.life.set("a1", {
              ...row,
              server_version: 10,
              payload: { ...row.payload, version: 10, encrypted_content: "v10" },
            });
          },
        }),
      ActionChangedError,
    );
    assert.equal(store.life.get("a1")?.payload.encrypted_content, "v10");
  });

  it("does not mark done from a later action sync after a lost op ack", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "complete",
      submissionId: "sub-lost",
      fields: fields({ what_changed: "потерянный ack" }),
    });
    const actionRow = store.life.get("a1")!;
    store.life.set("a1", {
      ...actionRow,
      local_rev: (actionRow.local_rev ?? 1) + 3,
      status: "synced",
      server_version: 12,
    });
    await refreshLifeOpStatus("u1");
    assert.equal(store.ops.get(op.id)?.status, "local");
    await applyLifeResult(
      {
        id: op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: op.feedback_local_rev ?? 1,
        payload: store.life.get(op.feedback_id)!.payload,
        status: "pending",
      },
      { status: "created", version: 1 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal(store.ops.get(op.id)?.status, "feedback_acked");
    await applyLifeResult(
      {
        id: "a1",
        owner: "u1",
        kind: "action",
        local_rev: op.action_local_rev ?? 1,
        payload: actionRow.payload,
        status: "pending",
      },
      { status: "updated", version: 5 },
    );
    await refreshLifeOpStatus("u1");
    const done = store.ops.get(op.id);
    assert.equal(done?.status, "done");
    assert.equal(done?.feedback_payload, null);
    assert.equal(done?.action_payload, null);
  });

  it("records action conflict without treating a later action as this op", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_no_effect",
      decision: "complete",
      submissionId: "sub-conflict",
      fields: fields({ what_changed: "конфликт" }),
    });
    await applyLifeResult(
      {
        id: op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: op.feedback_local_rev ?? 1,
        payload: store.life.get(op.feedback_id)!.payload,
        status: "pending",
      },
      { status: "created", version: 1 },
    );
    await applyLifeResult(
      {
        id: "a1",
        owner: "u1",
        kind: "action",
        local_rev: op.action_local_rev ?? 1,
        payload: store.life.get("a1")!.payload,
        status: "pending",
      },
      { status: "conflict", reason: "version_mismatch", version: 9 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal(store.ops.get(op.id)?.status, "action_conflict");
    assert.equal(store.life.get(op.feedback_id)?.status, "synced");
  });

  it("does not move a completed action when a historical continue is corrected", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const first = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "complete",
      submissionId: "sub-done",
      fields: fields({ what_changed: "закрыл", observed_on: "2026-09-12" }),
      planSnapshot: "экраны в 23:00",
    });
    store.life.set("a1", { ...store.life.get("a1")!, status: "synced", server_version: 5, payload: { ...store.life.get("a1")!.payload, state: "completed", version: 5 } });
    const fb = store.life.get(first.op.feedback_id)!;
    fb.status = "synced";
    fb.server_version = 1;
    store.life.set(fb.id, fb);
    store.ops.set(first.op.id, { ...first.op, status: "done", feedback_acked: true, action_acked: true, feedback_payload: null, action_payload: null });

    const existing: LifeFeedbackRead = {
      id: first.op.feedback_id,
      action_id: "a1",
      outcome_kind: "tried_helped",
      encrypted_dek: String(fb.payload.encrypted_dek),
      encrypted_content: String(fb.payload.encrypted_content),
      version: 1,
      created_at: "2026-09-12T18:00:00.000Z",
      updated_at: "2026-09-12T18:00:00.000Z",
    };
    const correction = await commitFeedbackCorrection({
      kek,
      action: action({ state: "completed", version: 5 }),
      outcome: "tried_no_effect",
      submissionId: "sub-corr",
      existingFeedback: existing,
      existingPlain: {
        decision: "continue",
        created_at: "2026-09-12T18:00:00.000Z",
        recorded_at: "2026-09-12T18:00:00.000Z",
        observed_on: "2026-09-12",
        plan_snapshot: "экраны в 23:00",
        action_version: 4,
      },
      fields: fields({ what_changed: "поправил оценку", observed_on: "2026-09-12" }),
      planSnapshot: "экраны в 23:00",
    });
    assert.equal(store.life.get("a1")?.payload.state, "completed");
    assert.equal(correction.op.kind, "feedback_correction");
    assert.equal(correction.op.action_payload, null);
    assert.equal(correction.op.feedback_id, first.op.feedback_id);
    const retry = await commitFeedbackCorrection({
      kek,
      action: action({ state: "completed", version: 5 }),
      outcome: "tried_no_effect",
      submissionId: "sub-corr",
      existingFeedback: existing,
      existingPlain: {
        decision: "continue",
        created_at: "2026-09-12T18:00:00.000Z",
        recorded_at: "2026-09-12T18:00:00.000Z",
        observed_on: "2026-09-12",
        plan_snapshot: "экраны в 23:00",
        action_version: 4,
      },
      fields: fields({ what_changed: "поправил оценку", observed_on: "2026-09-12" }),
      planSnapshot: "экраны в 23:00",
    });
    assert.equal(retry.op.feedback_id, first.op.feedback_id);
    assert.equal([...store.life.values()].filter((row) => row.kind === "feedback").length, 1);
    const row = await readLifeRow(first.op.feedback_id);
    assert.equal(row?.id, first.op.feedback_id);
  });
});
