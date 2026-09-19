import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRevisionAck } from "./queueAck.ts";
import type { QueueStatus } from "../db/offlineQueue.ts";

function row(partial: {
  local_rev: number;
  server_version?: number;
  status?: QueueStatus;
  owner?: string;
}) {
  return {
    local_rev: partial.local_rev,
    server_version: partial.server_version,
    status: partial.status ?? ("pending" as QueueStatus),
    owner_user_id: partial.owner ?? "user-a",
  };
}

describe("revision ack", () => {
  it("moves the acked server version onto a newer pending edit", () => {
    const current = row({ local_rev: 2, server_version: 7, status: "pending" });
    const out = applyRevisionAck(current, { owner: "user-a", local_rev: 1 }, { kind: "success", version: 8 });
    assert.equal(out.row.status, "pending");
    assert.equal(out.row.server_version, 8);
    assert.equal(out.drop, false);
  });

  it("does not treat a stale conflict as permission to overwrite", () => {
    const current = row({ local_rev: 2, server_version: 7, status: "pending" });
    const out = applyRevisionAck(
      current,
      { owner: "user-a", local_rev: 1 },
      { kind: "conflict", version: 9, reason: "version_mismatch" },
    );
    assert.equal(out.row.status, "pending");
    assert.equal(out.row.server_version, 7);
    assert.equal(out.row.conflict_version, 9);
  });

  it("ignores a stale reject and a stale error", () => {
    const current = row({ local_rev: 2, server_version: 3 });
    const rejected = applyRevisionAck(current, { owner: "user-a", local_rev: 1 }, { kind: "rejected", reason: "bad" });
    assert.equal(rejected.row.status, "pending");
    const errored = applyRevisionAck(current, { owner: "user-a", local_rev: 1 }, { kind: "error", reason: "offline" });
    assert.equal(errored.row.status, "pending");
  });

  it("does not drop a newer edit when an old delete is acked", () => {
    const current = row({ local_rev: 2, server_version: 4, status: "pending" });
    const out = applyRevisionAck(current, { owner: "user-a", local_rev: 1 }, { kind: "deleted", version: 5 });
    assert.equal(out.drop, false);
    assert.equal(out.row.status, "pending");
    assert.equal(out.row.server_version, 5);
  });

  it("drops only a matching delete ack", () => {
    const current = row({ local_rev: 2, status: "pending_delete" });
    const out = applyRevisionAck(current, { owner: "user-a", local_rev: 2 }, { kind: "deleted", version: 3 });
    assert.equal(out.drop, true);
  });

  it("ignores an ack after the account switched", () => {
    const current = row({ local_rev: 1, owner: "user-b" });
    const out = applyRevisionAck(current, { owner: "user-a", local_rev: 1 }, { kind: "success", version: 2 });
    assert.equal(out.ignored, true);
    assert.equal(out.row.status, "pending");
    assert.equal(out.row.server_version, undefined);
  });

  it("marks a matching conflict without advancing the CAS version", () => {
    const current = row({ local_rev: 1, server_version: 4 });
    const out = applyRevisionAck(
      current,
      { owner: "user-a", local_rev: 1 },
      { kind: "conflict", version: 6, reason: "version_mismatch" },
    );
    assert.equal(out.row.status, "conflict");
    assert.equal(out.row.server_version, 4);
    assert.equal(out.row.conflict_version, 6);
  });
});
