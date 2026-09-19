import Dexie, { type EntityTable } from "dexie";
import { LifeLogDB, type LifeOp, type PendingLife } from "../db/offlineQueue.ts";
import { deriveKEK, encryptEntry } from "./crypto.ts";
import { applyLifeResult, claimLifeForSend } from "./lifeQueue.ts";
import { refreshLifeOpStatus } from "./lifeOp.ts";

class LegacyLifeOpsDB extends Dexie {
  life_queue!: EntityTable<PendingLife, "id">;
  life_ops!: EntityTable<Record<string, unknown>, "id">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entries: "id, status, entry_type, timestamp, queued_at",
    });
    this.version(2).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id",
    });
    this.version(3).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id",
      chat_turns: "id, day, created_at",
      llm_settings: "id",
      pinned_charts: "id, created_at",
    });
    this.version(4).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id, owner_user_id",
      chat_turns: "id, day, created_at, owner_user_id",
      llm_settings: "id",
      pinned_charts: "id, created_at, owner_user_id",
      kek_verifiers: "owner_user_id",
    });
    this.version(5).stores({
      entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id, owner_user_id",
      chat_turns: "id, day, created_at, owner_user_id",
      llm_settings: "id",
      pinned_charts: "id, created_at, owner_user_id",
      kek_verifiers: "owner_user_id",
      life_queue: "id, kind, status, owner_user_id, queued_at",
    });
    this.version(6).stores({
      life_queue: "id, kind, status, owner_user_id, queued_at",
      life_ops: "id, owner_user_id, action_id, status",
    });
  }
}

export async function runDexieV6Migration(): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (typeof indexedDB === "undefined") {
    return { ok: false, notes: ["indexedDB unavailable"] };
  }
  const name = `lifelog-v6mig-${crypto.randomUUID()}`;
  const owner = "mig-owner";
  const kek = await deriveKEK("testdata1", "ab".repeat(16));
  const openCipher = await encryptEntry(JSON.stringify({ what_changed: "open-legacy" }), kek);
  const doneCipher = await encryptEntry(JSON.stringify({ what_changed: "done-legacy" }), kek);

  const legacy = new LegacyLifeOpsDB(name);
  try {
    await legacy.life_queue.bulkPut([
      {
        id: "fb-open",
        kind: "feedback",
        payload: { id: "fb-open", encrypted_content: openCipher.encrypted_content, encrypted_dek: openCipher.encrypted_dek, action_id: "a-open" },
        status: "pending",
        owner_user_id: owner,
        queued_at: 1,
        local_rev: 1,
      },
      {
        id: "a-open",
        kind: "action",
        payload: { id: "a-open", encrypted_content: "plan-open", encrypted_dek: "d", state: "accepted" },
        status: "pending",
        owner_user_id: owner,
        queued_at: 1,
        local_rev: 1,
      },
      {
        id: "fb-done",
        kind: "feedback",
        payload: { id: "fb-done", encrypted_content: doneCipher.encrypted_content, encrypted_dek: doneCipher.encrypted_dek, action_id: "a-done" },
        status: "synced",
        owner_user_id: owner,
        queued_at: 1,
        local_rev: 1,
        server_version: 1,
      },
      {
        id: "a-done",
        kind: "action",
        payload: { id: "a-done", encrypted_content: "plan-done", encrypted_dek: "d", state: "completed" },
        status: "synced",
        owner_user_id: owner,
        queued_at: 1,
        local_rev: 1,
        server_version: 5,
      },
    ]);
    await legacy.life_ops.bulkPut([
      {
        id: "op-open",
        owner_user_id: owner,
        session_id: 1,
        status: "local",
        action_id: "a-open",
        feedback_id: "fb-open",
        intent_key: "PLAINTEXT_SHOULD_LEAVE",
        feedback_payload: { encrypted_content: openCipher.encrypted_content, encrypted_dek: openCipher.encrypted_dek },
        action_payload: { encrypted_content: "plan-open", encrypted_dek: "d" },
        created_at: 10,
      },
      {
        id: "op-done",
        owner_user_id: owner,
        session_id: 1,
        status: "done",
        action_id: "a-done",
        feedback_id: "fb-done",
        intent_key: "PLAINTEXT_DONE_SHOULD_LEAVE",
        feedback_payload: { encrypted_content: doneCipher.encrypted_content, encrypted_dek: doneCipher.encrypted_dek },
        action_payload: { encrypted_content: "plan-done", encrypted_dek: "d" },
        created_at: 11,
      },
    ]);
    notes.push("seeded v6 open+done ops with intent_key");
  } finally {
    legacy.close();
  }

  const current = new LifeLogDB(name);
  try {
    const first = await current.life_ops.toArray();
    const open = first.find((row) => row.id === "op-open");
    const done = first.find((row) => row.id === "op-done");
    const dumped = JSON.stringify(first);
    const noIntent = !dumped.includes("intent_key") && !dumped.includes("PLAINTEXT_SHOULD_LEAVE");
    const idsKept = open?.owner_user_id === owner && done?.owner_user_id === owner && open?.feedback_id === "fb-open";
    const cipherKept =
      String(open?.feedback_payload?.encrypted_content) === openCipher.encrypted_content &&
      String(done?.feedback_payload?.encrypted_content) === doneCipher.encrypted_content;
    const submission = open?.submission_id === "op-open" && done?.submission_id === "op-done";
    notes.push(`after v7: open.sub=${open?.submission_id} done.status=${done?.status} noIntent=${noIntent}`);

    await refreshLifeOpStatus(owner, current);
    const afterRecover = await current.life_ops.get("op-open");
    notes.push(`recovered revs fb=${afterRecover?.feedback_local_rev} act=${afterRecover?.action_local_rev}`);

    const claimed = await claimLifeForSend(owner, current);
    const fbSnap = claimed.find((row) => row.id === "fb-open");
    const actSnap = claimed.find((row) => row.id === "a-open");
    if (fbSnap) await applyLifeResult(fbSnap, { status: "created", version: 1 }, current);
    if (actSnap) await applyLifeResult(actSnap, { status: "updated", version: 5 }, current);
    await refreshLifeOpStatus(owner, current);
    const delivered = await current.life_ops.get("op-open");
    notes.push(`delivered status=${delivered?.status} payloadNull=${delivered?.feedback_payload == null}`);

    current.close();
    const again = new LifeLogDB(name);
    try {
      const second = await again.life_ops.toArray();
      const open2 = second.find((row) => row.id === "op-open");
      const done2 = second.find((row) => row.id === "op-done");
      const stable =
        open2?.status === delivered?.status &&
        open2?.submission_id === "op-open" &&
        done2?.status === "done" &&
        done2?.owner_user_id === owner &&
        !JSON.stringify(second).includes("intent_key");
      notes.push(`reopen stable=${stable} open=${open2?.status} done=${done2?.status}`);
      const ok = Boolean(noIntent && idsKept && cipherKept && submission && delivered?.status === "done" && stable);
      return { ok, notes };
    } finally {
      again.close();
    }
  } catch (e) {
    notes.push((e as Error).message);
    return { ok: false, notes };
  } finally {
    current.close();
    await Dexie.delete(name);
  }
}

export type { LifeOp };
