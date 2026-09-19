import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLifeAck, nextLifeEnqueue } from "./lifeQueue.ts";
import { assembleMemoryProfile } from "./lifeProfile.ts";
import type { PendingLife } from "../db/offlineQueue.ts";

describe("C memory profile", () => {
  it("assembles only accepted items and stays rebuildable", () => {
    const profile = assembleMemoryProfile([
      { state: "proposed", kind: "preference", statement: "ignore" },
      { state: "accepted", kind: "preference", statement: "I prefer evening logs" },
      { state: "disputed", kind: "hypothesis", statement: "no" },
    ]);
    assert.deepEqual(profile, [{ kind: "preference", statement: "I prefer evening logs" }]);
  });
});

describe("life queue local revision", () => {
  it("does not mark rev2 synced when the server acks rev1", () => {
    const first = nextLifeEnqueue(
      undefined,
      "goal",
      { id: "g1", encrypted_content: "A", encrypted_dek: "d", state: "active" },
      "user-a",
    );
    assert.equal(first.local_rev, 1);
    first.inflight_rev = 1;

    const second = nextLifeEnqueue(
      first,
      "goal",
      { id: "g1", encrypted_content: "B", encrypted_dek: "d", state: "active" },
      "user-a",
    );
    assert.equal(second.local_rev, 2);
    assert.equal(second.payload.encrypted_content, "B");

    const afterAck = applyLifeAck(second, 1, { status: "created", version: 1 }).row;
    assert.equal(afterAck.status, "pending");
    assert.equal(afterAck.local_rev, 2);
    assert.equal(afterAck.server_version, 1);
    assert.equal(afterAck.payload.encrypted_content, "B");

    const afterSecond = applyLifeAck(afterAck, 2, { status: "updated", version: 2 }).row;
    assert.equal(afterSecond.status, "synced");
    assert.equal(afterSecond.server_version, 2);
  });

  it("keeps the first local created_at when the same feedback is edited later", () => {
    const first = nextLifeEnqueue(
      undefined,
      "feedback",
      { id: "f1", action_id: "a1", outcome_kind: "unevaluated", created_at: "2026-08-03T09:00:00.000Z" },
      "user-a",
    );
    const second = nextLifeEnqueue(
      first,
      "feedback",
      { id: "f1", action_id: "a1", outcome_kind: "tried_no_effect" },
      "user-a",
    );
    assert.equal(second.payload.created_at, "2026-08-03T09:00:00.000Z");
    assert.notEqual(second.payload.updated_at, "2026-08-03T09:00:00.000Z");
  });

  it("acks matching rev and records server version", () => {
    const row: PendingLife = nextLifeEnqueue(
      undefined,
      "action",
      { id: "a1", encrypted_content: "A", encrypted_dek: "d", state: "accepted" },
      "user-a",
    );
    const synced = applyLifeAck(row, 1, { status: "created", version: 1 }).row;
    assert.equal(synced.status, "synced");
    assert.equal(synced.server_version, 1);
  });

  it("keeps rejected visible instead of pretending it synced", () => {
    const row = nextLifeEnqueue(
      undefined,
      "memory",
      { id: "m1", encrypted_content: "A", encrypted_dek: "d", state: "proposed" },
      "user-a",
    );
    const rejected = applyLifeAck(row, 1, { status: "rejected", reason: "invalid_state" }).row;
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.last_error, "invalid_state");
  });

  it("keeps a version conflict distinct from a successful sync", () => {
    const row = nextLifeEnqueue(
      undefined,
      "goal",
      { id: "g2", encrypted_content: "A", encrypted_dek: "d", state: "active" },
      "user-a",
    );
    const conflicted = applyLifeAck(row, 1, { status: "conflict", reason: "version_mismatch" }).row;
    assert.equal(conflicted.status, "conflict");
    assert.notEqual(conflicted.status, "synced");
  });

  it("does not turn a stale conflict into a CAS overwrite", () => {
    const first = nextLifeEnqueue(undefined, "goal", { id: "g3", encrypted_content: "A", state: "active" }, "user-a");
    first.server_version = 7;
    const second = nextLifeEnqueue(first, "goal", { id: "g3", encrypted_content: "B", state: "active" }, "user-a");
    const after = applyLifeAck(second, 1, { status: "conflict", reason: "version_mismatch", version: 9 }).row;
    assert.equal(after.status, "pending");
    assert.equal(after.server_version, 7);
    assert.equal(after.conflict_version, 9);
    assert.equal(after.payload.encrypted_content, "B");
  });
});
