import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { installTestQueue, uninstallTestQueue } from "../db/testQueue.ts";
import {
  enqueueLife,
  persistServerLife,
  resolveLifeApplyLocal,
  resolveLifeKeepServer,
} from "./lifeQueue.ts";
import { mergeLifeBundle } from "./mergeLife.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";

describe("life cache and conflict resolve", () => {
  afterEach(() => {
    uninstallTestQueue();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("persists another-device goal and keeps it when getLife is later unavailable", async () => {
    const store = installTestQueue();
    await persistServerLife(
      {
        goals: [
          {
            id: "g-remote",
            state: "active",
            encrypted_dek: "d",
            encrypted_content: "remote",
            created_at: "t",
            updated_at: "t",
            version: 2,
          },
        ],
        memory: [],
        actions: [],
        feedback: [],
        due_action_ids: [],
      },
      "u1",
    );
    assert.equal(store.life.get("g-remote")?.status, "synced");
    const merged = mergeLifeBundle(undefined, [...store.life.values()], "u1");
    assert.equal(merged.goals[0].id, "g-remote");
  });

  it("does not overwrite a pending local edit when the server cache arrives", async () => {
    const store = installTestQueue();
    setCurrentUserId("u1");
    setEncryptAllowed(true);
    await enqueueLife("goal", { id: "g1", encrypted_content: "local", encrypted_dek: "d", state: "active" });
    await persistServerLife(
      {
        goals: [
          {
            id: "g1",
            state: "active",
            encrypted_dek: "d",
            encrypted_content: "server",
            created_at: "t",
            updated_at: "t",
            version: 4,
          },
        ],
        memory: [],
        actions: [],
        feedback: [],
        due_action_ids: [],
      },
      "u1",
    );
    const row = store.life.get("g1");
    assert.equal(row?.status, "pending");
    assert.equal(row?.payload.encrypted_content, "local");
    assert.equal(row?.server_snapshot?.encrypted_content, "server");
  });

  it("keeps the server copy only after an explicit resolve", async () => {
    const store = installTestQueue();
    store.life.set("g1", {
      id: "g1",
      kind: "goal",
      payload: { encrypted_content: "local", encrypted_dek: "d", state: "active" },
      status: "conflict",
      owner_user_id: "u1",
      queued_at: 1,
      local_rev: 2,
      server_version: 3,
      conflict_version: 5,
      server_snapshot: { encrypted_content: "server", encrypted_dek: "d", state: "active", version: 5 },
    });
    await resolveLifeKeepServer("g1", "u1");
    assert.equal(store.life.get("g1")?.status, "synced");
    assert.equal(store.life.get("g1")?.payload.encrypted_content, "server");
    await resolveLifeApplyLocal("g1", "u1");
    assert.equal(store.life.get("g1")?.status, "pending");
    assert.equal(store.life.get("g1")?.server_version, 5);
  });

  it("keeps an August created_at after a September cache write", async () => {
    const store = installTestQueue();
    await persistServerLife(
      {
        goals: [],
        memory: [],
        actions: [
          {
            id: "a-aug",
            goal_id: "g1",
            state: "accepted",
            encrypted_dek: "d",
            encrypted_content: "plan",
            created_at: "2026-08-02T10:00:00.000Z",
            updated_at: "2026-08-02T10:00:00.000Z",
            version: 1,
          },
        ],
        feedback: [],
        due_action_ids: [],
      },
      "u1",
    );
    const merged = mergeLifeBundle(undefined, [...store.life.values()], "u1");
    assert.equal(merged.actions[0].created_at, "2026-08-02T10:00:00.000Z");
  });

  it("does not apply a delayed version 7 over a cached version 8", async () => {
    const store = installTestQueue();
    const base = {
      goals: [
        {
          id: "g1",
          state: "active",
          encrypted_dek: "d",
          encrypted_content: "v8",
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          version: 8,
        },
      ],
      memory: [],
      actions: [],
      feedback: [],
      due_action_ids: [],
    };
    await persistServerLife(base, "u1");
    await persistServerLife(
      {
        ...base,
        goals: [{ ...base.goals[0], encrypted_content: "v7", updated_at: "2026-08-20T00:00:00.000Z", version: 7 }],
      },
      "u1",
    );
    assert.equal(store.life.get("g1")?.server_version, 8);
    assert.equal(store.life.get("g1")?.payload.encrypted_content, "v8");
    const staleServer = {
      ...base,
      goals: [{ ...base.goals[0], encrypted_content: "v7", version: 7 }],
    };
    const merged = mergeLifeBundle(staleServer, [...store.life.values()], "u1");
    assert.equal(merged.goals[0].encrypted_content, "v8");
    assert.equal(merged.goals[0].version, 8);
  });
});
