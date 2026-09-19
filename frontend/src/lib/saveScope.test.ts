import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { deriveKEK } from "./crypto.ts";
import {
  getCurrentUserId,
  setCurrentUserId,
  setEncryptAllowed,
} from "./accountScope.ts";
import { encryptAndEnqueue } from "./entrySubmit.ts";
import { db, getPendingForSync } from "../db/offlineQueue.ts";
import { resetTestDb } from "../test/resetDb.ts";
import { encryptLifePayload, enqueueLife, getPendingLife } from "./lifeQueue.ts";

const SALT = "ab".repeat(16);

async function kek(): Promise<CryptoKey> {
  return deriveKEK("testdata1", SALT);
}

describe("save scope across account switch", () => {
  afterEach(async () => {
    await resetTestDb();
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("keeps an entry owned by A when the account switches during encrypt", async () => {
    setCurrentUserId("user-a");
    setEncryptAllowed(true);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = encryptAndEnqueue({
      kek: await kek(),
      entry_type: "THOUGHT",
      plaintext: { content: "from A" },
      openFields: { tags: ["a"] },
      afterEncrypt: () => hold,
    });

    setCurrentUserId("user-b");
    release();
    const saved = await pending;

    const row = await db.entries.get(saved.id);
    assert.equal(row?.owner_user_id, "user-a");
    assert.equal(getCurrentUserId(), "user-b");
    assert.equal((await getPendingForSync(50, "user-b")).length, 0);
    assert.equal((await getPendingForSync(50, "user-a")).length, 1);
  });

  it("keeps a life item owned by A when the account switches during encrypt", async () => {
    setCurrentUserId("user-a");
    setEncryptAllowed(true);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const key = await kek();
    const work = (async () => {
      const blob = await encryptLifePayload(key, { title: "goal A" }, { afterEncrypt: () => hold });
      const id = "11111111-1111-4111-8111-111111111111";
      await enqueueLife(
        "goal",
        {
          id,
          state: "active",
          encrypted_dek: blob.encrypted_dek,
          encrypted_content: blob.encrypted_content,
        },
        blob.scope,
      );
      return id;
    })();

    setCurrentUserId("user-b");
    release();
    const id = await work;

    assert.equal((await db.life_queue.get(id))?.owner_user_id, "user-a");
    assert.equal((await getPendingLife("user-b")).length, 0);
    assert.equal((await getPendingLife("user-a")).length, 1);
  });
});
