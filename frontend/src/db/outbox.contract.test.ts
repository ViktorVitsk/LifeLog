import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { applyOpEntityAck, db } from "./offlineQueue.ts";
import { entityKey, getOp, operationKey, putEntry, putLife, putOp } from "./outbox.ts";
import { resetTestDb } from "../test/resetDb.ts";

describe("outbox row contract", () => {
  afterEach(async () => {
    await resetTestDb();
  });

  it("uses entity and operation key prefixes and preserves date types", async () => {
    await putEntry(db, {
      id: "e1",
      timestamp: "2026-09-19T00:00:00.000Z",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "c",
      tags: [],
      status: "pending",
      queued_at: 1,
      attempts: 0,
      owner_user_id: "u1",
      local_rev: 1,
      created_at: "2026-09-19T00:00:00.000Z",
      cached_at: "2026-09-19T01:00:00.000Z",
    });
    await putLife(db, {
      id: "a1",
      kind: "action",
      payload: { id: "a1", created_at: "2026-09-01T00:00:00.000Z" },
      status: "pending",
      owner_user_id: "u1",
      queued_at: 2,
      local_rev: 1,
    });
    await putOp(db, {
      id: "op1",
      owner_user_id: "u1",
      session_id: 1,
      kind: "feedback_and_action",
      status: "local",
      submission_id: "sub1",
      feedback_id: "fb1",
      action_id: "a1",
      created_at: 12345,
      feedback_local_rev: 1,
      action_local_rev: 1,
    });
    const entity = await db.outbox.get(entityKey("entry", "e1"));
    const op = await db.outbox.get(operationKey("op1"));
    assert.equal(entity?.record_type, "entity");
    assert.equal(entity && "created_at" in entity && typeof entity.created_at, "string");
    assert.equal(op?.record_type, "operation");
    assert.equal(op && "created_at" in op && typeof op.created_at, "number");
    assert.equal((await getOp(db, "op1"))?.created_at, 12345);
  });

  it("applies exact conflict on feedback to action_conflict even after entity overwrite", async () => {
    const op = applyOpEntityAck(
      {
        id: "op1",
        owner_user_id: "u1",
        session_id: 1,
        kind: "feedback_and_action",
        status: "local",
        submission_id: "sub1",
        feedback_id: "fb1",
        action_id: "a1",
        feedback_local_rev: 1,
        action_local_rev: 2,
        created_at: 1,
      },
      "fb1",
      1,
      { status: "rejected" },
    );
    assert.equal(op.status, "action_conflict");
  });
});
