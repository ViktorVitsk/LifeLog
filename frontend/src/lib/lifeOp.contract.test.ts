import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { webcrypto } from "node:crypto";
import { db, type LifeLogDB, type LifeOp } from "../db/offlineQueue.ts";
import { deleteLife, getLife, getOp, listLife, listOps, putLife, putOp } from "../db/outbox.ts";
import { resetTestDb } from "../test/resetDb.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";
import { deriveKEK } from "./crypto.ts";
import {
  FeedbackChangedError,
  SubmissionReusedError,
  commitFeedbackCorrection,
  commitFeedbackDecision,
  recoverLegacyOpRevs,
  refreshLifeOpStatus,
} from "./lifeOp.ts";
import { applyLifeResult, readLifeRow, resolveLifeApplyLocal, resolveLifeKeepServer } from "./lifeQueue.ts";
import type { LifeActionRead, LifeFeedbackRead } from "./api.ts";

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

function fields(over: Partial<{ what_changed: string; difficulty: string; side_effects: string; observed_on: string; plan_text?: string }> = {}) {
  return {
    what_changed: "экраны до 00:20",
    difficulty: "переписка",
    side_effects: "",
    observed_on: "2026-09-19",
    ...over,
  };
}

async function asFeedback(op: LifeOp, store: LifeLogDB, version = 1): Promise<LifeFeedbackRead> {
  const row = (await getLife(store, op.feedback_id))!;
  return {
    id: op.feedback_id,
    action_id: "a1",
    outcome_kind: "tried_helped",
    encrypted_dek: String(row.payload.encrypted_dek),
    encrypted_content: String(row.payload.encrypted_content),
    version,
    created_at: "2026-09-12T18:00:00.000Z",
    updated_at: "2026-09-12T18:00:00.000Z",
  };
}

async function ackOp(store: LifeLogDB, op: LifeOp, owner = "u1") {
  await applyLifeResult(
    {
      id: op.feedback_id,
      owner,
      kind: "feedback",
      local_rev: op.feedback_local_rev ?? 1,
      payload: (await getLife(store, op.feedback_id))!.payload,
      status: "pending",
    },
    { status: "created", version: 1 },
  );
  if (op.action_local_rev != null) {
    await applyLifeResult(
      {
        id: op.action_id,
        owner,
        kind: "action",
        local_rev: op.action_local_rev,
        payload: (await getLife(store, op.action_id))!.payload,
        status: "pending",
      },
      { status: "updated", version: 5 },
    );
  }
  await refreshLifeOpStatus(owner);
}

describe("submission_id retry contract", () => {
  let kek: CryptoKey;
  before(async () => {
    kek = await deriveKEK("testdata1", SALT);
  });
  afterEach(async () => {
    await resetTestDb();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("reuses one feedback before the first ack", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const body = {
      kek,
      action: action(),
      outcome: "tried_no_effect" as const,
      decision: "complete" as const,
      submissionId: "sub-pre-ack",
      fields: fields({ what_changed: "до ack" }),
    };
    const first = await commitFeedbackDecision(body);
    const actionRev = (await getLife(store, "a1"))!.local_rev;
    const retry = await commitFeedbackDecision(body);
    assert.equal(retry.op.id, first.op.id);
    assert.equal(retry.op.feedback_id, first.op.feedback_id);
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 1);
    assert.equal((await getLife(store, "a1"))!.local_rev, actionRev);
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
  });

  it("reuses the same op after a partial ack without a second feedback", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const body = {
      kek,
      action: action(),
      outcome: "tried_helped" as const,
      decision: "complete" as const,
      submissionId: "sub-partial",
      fields: fields({ what_changed: "частичный" }),
    };
    const first = await commitFeedbackDecision(body);
    await applyLifeResult(
      {
        id: first.op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: first.op.feedback_local_rev ?? 1,
        payload: (await getLife(store, first.op.feedback_id))!.payload,
        status: "pending",
      },
      { status: "created", version: 1 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, first.op.id))?.status, "feedback_acked");
    const actionRev = (await getLife(store, "a1"))!.local_rev;
    const retry = await commitFeedbackDecision(body);
    assert.equal(retry.op.id, first.op.id);
    assert.equal(retry.op.feedback_id, first.op.feedback_id);
    assert.equal((await getOp(store, first.op.id))?.status, "feedback_acked");
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 1);
    assert.equal((await getLife(store, "a1"))!.local_rev, actionRev);
  });

  it("returns the done result and does not create feedback or bump revs", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const body = {
      kek,
      action: action(),
      outcome: "tried_no_effect" as const,
      decision: "complete" as const,
      submissionId: "sub-done",
      fields: fields({ what_changed: "готово" }),
    };
    const first = await commitFeedbackDecision(body);
    await ackOp(store, first.op);
    assert.equal((await getOp(store, first.op.id))?.status, "done");
    assert.equal((await getOp(store, first.op.id))?.feedback_payload, null);
    const actionRev = (await getLife(store, "a1"))!.local_rev;
    const retry = await commitFeedbackDecision({
      ...body,
      fields: fields({ what_changed: "другой текст того же id" }),
    });
    assert.equal(retry.op.id, first.op.id);
    assert.equal(retry.op.status, "done");
    assert.equal(retry.op.feedback_id, first.op.feedback_id);
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 1);
    assert.equal((await getLife(store, "a1"))!.local_rev, actionRev);
    assert.equal((await getOp(store, first.op.id))?.status, "done");
  });

  it("finds the same done op after a simulated reload", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const first = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "unevaluated",
      decision: "continue",
      submissionId: "sub-reload",
      fields: fields({ what_changed: "после reload" }),
    });
    await ackOp(store, first.op);
    const retry = await commitFeedbackDecision({
      kek,
      action: action({ state: "accepted", version: 5 }),
      outcome: "unevaluated",
      decision: "continue",
      submissionId: "sub-reload",
      fields: fields({ what_changed: "после reload" }),
    });
    assert.equal(retry.op.id, first.op.id);
    assert.equal(retry.op.status, "done");
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 1);
  });

  it("keeps one op for two concurrent retries after done", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const body = {
      kek,
      action: action(),
      outcome: "tried_helped" as const,
      decision: "stop" as const,
      submissionId: "sub-conc-done",
      fields: fields({ what_changed: "параллель" }),
    };
    const first = await commitFeedbackDecision(body);
    await ackOp(store, first.op);
    const [a, b] = await Promise.all([commitFeedbackDecision(body), commitFeedbackDecision(body)]);
    assert.equal(a.op.id, first.op.id);
    assert.equal(b.op.id, first.op.id);
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 1);
    assert.equal((await getOp(store, first.op.id))?.status, "done");
  });

  it("rejects a changed payload on the same open submission_id", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_no_effect",
      decision: "complete",
      submissionId: "sub-reuse",
      fields: fields({ what_changed: "первый текст" }),
    });
    const actionRev = (await getLife(store, "a1"))!.local_rev;
    await assert.rejects(
      () =>
        commitFeedbackDecision({
          kek,
          action: action(),
          outcome: "tried_helped",
          decision: "complete",
          submissionId: "sub-reuse",
          fields: fields({ what_changed: "другой текст" }),
        }),
      SubmissionReusedError,
    );
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 1);
    assert.equal((await getLife(store, "a1"))!.local_rev, actionRev);
  });

  it("creates a new observation when the text matches but submission_id is new", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const same = fields({ what_changed: "один и тот же текст" });
    const first = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "not_tried",
      decision: "continue",
      submissionId: "sub-text-a",
      fields: same,
    });
    const second = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "not_tried",
      decision: "continue",
      submissionId: "sub-text-b",
      fields: same,
    });
    assert.notEqual(second.op.id, first.op.id);
    assert.notEqual(second.op.feedback_id, first.op.feedback_id);
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 2);
    assert.equal((await getOp(store, first.op.id))?.status, "superseded");
  });

  it("applies the same retry contract to a finished correction", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const first = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "complete",
      submissionId: "sub-base",
      fields: fields({ what_changed: "закрыл" }),
    });
    await ackOp(store, first.op);
    const actionRow = (await getLife(store, "a1"))!;
    await putLife(store, {
      ...actionRow,
      payload: { ...actionRow.payload, state: "completed", version: 5 },
    });
    const existing = await asFeedback(first.op, store, 1);
    const corrBody = {
      kek,
      action: action({ state: "completed" as const, version: 5 }),
      outcome: "tried_no_effect" as const,
      submissionId: "sub-corr-done",
      existingFeedback: existing,
      existingPlain: { decision: "complete", created_at: "2026-09-12T18:00:00.000Z", observed_on: "2026-09-12" },
      fields: fields({ what_changed: "поправил", observed_on: "2026-09-12" }),
      expectedFeedbackVersion: 1,
      expectedFeedbackLocalRev: (await getLife(store, first.op.feedback_id))?.local_rev ?? 0,
    };
    const corr = await commitFeedbackCorrection(corrBody);
    await applyLifeResult(
      {
        id: corr.op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: corr.op.feedback_local_rev ?? 1,
        payload: (await getLife(store, corr.op.feedback_id))!.payload,
        status: "pending",
      },
      { status: "updated", version: 2 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, corr.op.id))?.status, "done");
    const actionRev = (await getLife(store, "a1"))!.local_rev;
    const retry = await commitFeedbackCorrection({
      ...corrBody,
      fields: fields({ what_changed: "ещё раз тот же id" }),
    });
    assert.equal(retry.op.id, corr.op.id);
    assert.equal(retry.op.status, "done");
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
    assert.equal((await getLife(store, "a1"))!.local_rev, actionRev);
    assert.equal((await listLife(store)).filter((row) => row.kind === "feedback").length, 1);
  });
});

describe("feedback correction CAS", () => {
  let kek: CryptoKey;
  before(async () => {
    kek = await deriveKEK("testdata1", SALT);
  });
  afterEach(async () => {
    await resetTestDb();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  async function seedDone(store: LifeLogDB) {
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const first = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "complete",
      submissionId: "sub-seed",
      fields: fields({ what_changed: "закрыл" }),
    });
    await ackOp(store, first.op);
    const actionRow = (await getLife(store, "a1"))!;
    await putLife(store, {
      ...actionRow,
      payload: { ...actionRow.payload, state: "completed", version: 5 },
    });
    return first.op;
  }

  it("rejects a v1 edit after v2 arrived and keeps the draft off the queue", async () => {
    const store = db;
    const op = await seedDone(store);
    const row = (await getLife(store, op.feedback_id))!;
    await putLife(store, {
      ...row,
      server_version: 2,
      payload: { ...row.payload, version: 2, encrypted_content: "v2-cipher" },
    });
    const actionRev = (await getLife(store, "a1"))!.local_rev;
    const existing = await asFeedback(op, store, 1);
    await assert.rejects(
      () =>
        commitFeedbackCorrection({
          kek,
          action: action({ state: "completed", version: 5 }),
          outcome: "tried_no_effect",
          submissionId: "sub-stale-v1",
          existingFeedback: existing,
          existingPlain: { decision: "complete", created_at: "2026-09-12T18:00:00.000Z" },
          fields: fields({ what_changed: "старый экран" }),
          expectedFeedbackVersion: 1,
          expectedFeedbackLocalRev: row.local_rev ?? 0,
        }),
      FeedbackChangedError,
    );
    assert.equal((await getLife(store, op.feedback_id))?.payload.encrypted_content, "v2-cipher");
    assert.equal((await getLife(store, op.feedback_id))?.server_version, 2);
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
    assert.equal((await getLife(store, "a1"))!.local_rev, actionRev);
    assert.equal((await listOps(store)).some((item) => item.submission_id === "sub-stale-v1"), false);
  });

  it("rejects another local edit that appears during encrypt", async () => {
    const store = db;
    const op = await seedDone(store);
    const row = (await getLife(store, op.feedback_id))!;
    const existing = await asFeedback(op, store, 1);
    await assert.rejects(
      () =>
        commitFeedbackCorrection({
          kek,
          action: action({ state: "completed", version: 5 }),
          outcome: "tried_no_effect",
          submissionId: "sub-enc-race",
          existingFeedback: existing,
          existingPlain: { decision: "complete" },
          fields: fields({ what_changed: "черновик вкладки A" }),
          expectedFeedbackVersion: 1,
          expectedFeedbackLocalRev: row.local_rev ?? 0,
          afterEncrypt: async () => {
            const current = (await getLife(store, op.feedback_id))!;
            await putLife(store, {
              ...current,
              local_rev: (current.local_rev ?? 0) + 1,
              payload: { ...current.payload, encrypted_content: "tab-b" },
            });
          },
        }),
      FeedbackChangedError,
    );
    assert.equal((await getLife(store, op.feedback_id))?.payload.encrypted_content, "tab-b");
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
  });

  it("rejects a correction after the review is deleted", async () => {
    const store = db;
    const op = await seedDone(store);
    await putLife(store, { ...(await getLife(store, op.feedback_id))!, status: "pending_delete" });
    const existing = await asFeedback(op, store, 1);
    await assert.rejects(
      () =>
        commitFeedbackCorrection({
          kek,
          action: action({ state: "completed", version: 5 }),
          outcome: "tried_no_effect",
          submissionId: "sub-deleted",
          existingFeedback: existing,
          fields: fields({ what_changed: "уже удалено" }),
          expectedFeedbackVersion: 1,
          expectedFeedbackLocalRev: 1,
        }),
      FeedbackChangedError,
    );
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
  });

  it("lets only one of two parallel corrections write", async () => {
    const store = db;
    const op = await seedDone(store);
    const row = (await getLife(store, op.feedback_id))!;
    const body = {
      kek,
      action: action({ state: "completed" as const, version: 5 }),
      outcome: "tried_no_effect" as const,
      existingFeedback: await asFeedback(op, store, 1),
      existingPlain: { decision: "complete" },
      fields: fields({ what_changed: "две вкладки" }),
      expectedFeedbackVersion: 1,
      expectedFeedbackLocalRev: row.local_rev ?? 0,
    };
    const results = await Promise.allSettled([
      commitFeedbackCorrection({ ...body, submissionId: "tab-a" }),
      commitFeedbackCorrection({ ...body, submissionId: "tab-b" }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].status === "rejected" && rejected[0].reason instanceof FeedbackChangedError);
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
    assert.equal((await listLife(store)).filter((item) => item.kind === "feedback").length, 1);
  });

  it("saves the chosen snapshot after the user resolves the version conflict", async () => {
    const store = db;
    const op = await seedDone(store);
    const row = (await getLife(store, op.feedback_id))!;
    await putLife(store, {
      ...row,
      server_version: 2,
      payload: { ...row.payload, version: 2 },
    });
    const staleFeedback = { ...(await asFeedback(op, store, 2)), version: 1 };
    await assert.rejects(
      () =>
        commitFeedbackCorrection({
          kek,
          action: action({ state: "completed", version: 5 }),
          outcome: "tried_no_effect",
          submissionId: "sub-resolve",
          existingFeedback: staleFeedback,
          fields: fields({ what_changed: "мой выбор" }),
          expectedFeedbackVersion: 1,
          expectedFeedbackLocalRev: row.local_rev ?? 0,
        }),
      FeedbackChangedError,
    );
    const saved = await commitFeedbackCorrection({
      kek,
      action: action({ state: "completed", version: 5 }),
      outcome: "tried_no_effect",
      submissionId: "sub-resolve-ok",
      existingFeedback: await asFeedback(op, store, 2),
      fields: fields({ what_changed: "мой выбор" }),
      expectedFeedbackVersion: 2,
      expectedFeedbackLocalRev: (await getLife(store, op.feedback_id))?.local_rev ?? 0,
    });
    assert.equal(saved.op.kind, "feedback_correction");
    assert.equal(saved.op.action_payload, null);
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
    const queued = await readLifeRow(op.feedback_id);
    assert.equal(queued?.status, "pending");
    assert.equal(queued?.server_version, 2);
  });

  it("rejects a correction aimed at a different action", async () => {
    const store = db;
    const op = await seedDone(store);
    const existing = await asFeedback(op, store, 1);
    await assert.rejects(
      () =>
        commitFeedbackCorrection({
          kek,
          action: action({ id: "a-other", state: "completed", version: 5 }),
          outcome: "tried_no_effect",
          submissionId: "sub-wrong-action",
          existingFeedback: existing,
          fields: fields({ what_changed: "чужое действие" }),
        }),
      FeedbackChangedError,
    );
    assert.equal((await getLife(store, "a1"))!.payload.state, "completed");
  });
});

describe("compound operation state sequences", () => {
  let kek: CryptoKey;
  before(async () => {
    kek = await deriveKEK("testdata1", SALT);
  });
  afterEach(async () => {
    await resetTestDb();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("tracks action-first then feedback, conflict, resolve, and done", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_no_effect",
      decision: "complete",
      submissionId: "sub-seq",
      fields: fields({ what_changed: "последовательность" }),
    });
    await applyLifeResult(
      {
        id: "a1",
        owner: "u1",
        kind: "action",
        local_rev: op.action_local_rev ?? 1,
        payload: (await getLife(store, "a1"))!.payload,
        status: "pending",
      },
      { status: "updated", version: 5 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, op.id))?.status, "action_acked");

    await applyLifeResult(
      {
        id: op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: op.feedback_local_rev ?? 1,
        payload: (await getLife(store, op.feedback_id))!.payload,
        status: "pending",
      },
      { status: "conflict", reason: "version_mismatch", version: 3 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, op.id))?.status, "action_conflict");

    await resolveLifeApplyLocal(op.feedback_id, "u1");
    await refreshLifeOpStatus("u1");
    assert.notEqual((await getOp(store, op.id))?.status, "action_conflict");
    const resolvedRev = (await getLife(store, op.feedback_id))!.local_rev;
    await applyLifeResult(
      {
        id: op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: resolvedRev ?? 1,
        payload: (await getLife(store, op.feedback_id))!.payload,
        status: "pending",
      },
      { status: "updated", version: 4 },
    );
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, op.id))?.status, "done");
  });

  it("does not treat keep-server as success of this op and does not hide a correction", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const first = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "complete",
      submissionId: "sub-keep",
      fields: fields({ what_changed: "локальное" }),
    });
    await applyLifeResult(
      {
        id: first.op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: first.op.feedback_local_rev ?? 1,
        payload: (await getLife(store, first.op.feedback_id))!.payload,
        status: "pending",
      },
      { status: "created", version: 1 },
    );
    await applyLifeResult(
      {
        id: "a1",
        owner: "u1",
        kind: "action",
        local_rev: first.op.action_local_rev ?? 1,
        payload: (await getLife(store, "a1"))!.payload,
        status: "pending",
      },
      { status: "conflict", reason: "version_mismatch", version: 9 },
    );
    const conflicted = (await getLife(store, "a1"))!;
    await putLife(store, {
      ...conflicted,
      server_snapshot: { ...conflicted.payload, encrypted_content: "server-plan", version: 9 },
      conflict_version: 9,
    });
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, first.op.id))?.status, "action_conflict");
    await resolveLifeKeepServer("a1", "u1");
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, first.op.id))?.status, "feedback_acked");
    assert.equal((await getLife(store, "a1"))?.payload.encrypted_content, "server-plan");

    const corr = await commitFeedbackCorrection({
      kek,
      action: action({ state: "accepted", version: 9 }),
      outcome: "tried_no_effect",
      submissionId: "sub-corr-open",
      existingFeedback: await asFeedback(first.op, store, 1),
      fields: fields({ what_changed: "самостоятельный отзыв" }),
      expectedFeedbackVersion: 1,
      expectedFeedbackLocalRev: (await getLife(store, first.op.feedback_id))?.local_rev ?? 0,
    });
    assert.equal(corr.op.status, "local");
    const newer = await commitFeedbackDecision({
      kek,
      action: action({ version: 9 }),
      outcome: "not_tried",
      decision: "continue",
      submissionId: "sub-new-decision",
      fields: fields({ what_changed: "новое решение" }),
    });
    assert.equal((await getOp(store, first.op.id))?.status, "superseded");
    assert.equal((await getOp(store, corr.op.id))?.status, "local");
    assert.equal((await getOp(store, newer.op.id))?.status, "local");
    await applyLifeResult(
      {
        id: first.op.feedback_id,
        owner: "u1",
        kind: "feedback",
        local_rev: first.op.feedback_local_rev ?? 1,
        payload: (await getLife(store, first.op.feedback_id))!.payload,
        status: "synced",
      },
      { status: "updated", version: 1 },
    );
    assert.equal((await getOp(store, first.op.id))?.status, "superseded");
    assert.equal((await getOp(store, corr.op.id))?.status, "local");
  });

  it("does not mark success from a missing row, a later rev, or a stale refresh", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "unevaluated",
      decision: "continue",
      submissionId: "sub-stale",
      fields: fields({ what_changed: "старый refresh" }),
    });
    await deleteLife(store, op.feedback_id);
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, op.id))?.status, "local");
    assert.equal((await getOp(store, op.id))?.feedback_acked, false);

    await putLife(store, {
      ...(await getLife(store, "a1"))!,
      local_rev: (op.action_local_rev ?? 1) + 4,
      status: "synced",
      server_version: 12,
    });
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, op.id))?.status, "local");

    const before = (await getOp(store, op.id))!;
    await applyLifeResult(
      {
        id: "a1",
        owner: "u1",
        kind: "action",
        local_rev: op.action_local_rev ?? 1,
        payload: { encrypted_content: "plan" },
        status: "pending",
      },
      { status: "updated", version: 5 },
    );
    const acked = (await getOp(store, op.id))!;
    assert.equal(acked.action_acked, true);
    assert.ok((acked.status_seq ?? 0) > (before.status_seq ?? 0));
    await refreshLifeOpStatus("u1");
    assert.equal((await getOp(store, op.id))?.action_acked, true);
    assert.notEqual((await getOp(store, op.id))?.status, "done");
  });

  it("does not return a done op to local on retry and recovers missing revs by ciphertext", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "tried_helped",
      decision: "complete",
      submissionId: "sub-recover",
      fields: fields({ what_changed: "ревизии" }),
    });
    await ackOp(store, op);
    assert.equal((await getOp(store, op.id))?.status, "done");
    const retry = await commitFeedbackDecision({
      kek,
      action: action({ version: 5 }),
      outcome: "tried_helped",
      decision: "complete",
      submissionId: "sub-recover",
      fields: fields({ what_changed: "ревизии" }),
    });
    assert.equal(retry.op.status, "done");
    assert.equal((await getOp(store, op.id))?.status, "done");

    const leftover = {
      ...op,
      status: "local" as const,
      feedback_acked: false,
      action_acked: false,
      feedback_local_rev: null,
      action_local_rev: null,
      feedback_payload: op.feedback_payload,
      action_payload: op.action_payload,
    };
    const recovered = recoverLegacyOpRevs(leftover, await getLife(store, op.feedback_id), await getLife(store, "a1"));
    assert.equal(recovered.feedback_local_rev, (await getLife(store, op.feedback_id))?.local_rev);
    assert.equal(recovered.action_local_rev, (await getLife(store, "a1"))?.local_rev);
  });

  it("does not bind legacy revs when ciphertext no longer matches", async () => {
    const store = db;
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    const { op } = await commitFeedbackDecision({
      kek,
      action: action(),
      outcome: "not_tried",
      decision: "continue",
      submissionId: "sub-nomatch",
      fields: fields({ what_changed: "старое" }),
    });
    const recovered = recoverLegacyOpRevs(
      { ...op, feedback_local_rev: null, action_local_rev: null },
      { ...(await getLife(store, op.feedback_id))!, payload: { ...(await getLife(store, op.feedback_id))!.payload, encrypted_content: "other" } },
      await getLife(store, "a1"),
    );
    assert.equal(recovered.feedback_local_rev, null);
  });
});
