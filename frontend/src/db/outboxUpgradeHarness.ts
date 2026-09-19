import Dexie from "dexie";
import { LifeLogDB, type LifeOp, type PendingEntry } from "./offlineQueue.ts";
import { LifeLogDBv7 } from "./lifeLogLegacy.ts";
import { OUTBOX_STORE, getEntry, getLife, getOp, isOutboxEntity, isOutboxOperation, listEntries, listLife, listOps, operationKey } from "./outbox.ts";
import { applyLifeResult, claimLifeForSend } from "../lib/lifeQueue.ts";
import { refreshLifeOpStatus } from "../lib/lifeOp.ts";

const OWNER = "mig-owner";

function pendingEntry(partial: Partial<PendingEntry> & Pick<PendingEntry, "id">): PendingEntry {
  return {
    timestamp: "2026-09-19T10:00:00.000Z",
    entry_type: "THOUGHT",
    encrypted_dek: "dek-pending",
    encrypted_content: "ct-pending",
    tags: [],
    status: "pending",
    queued_at: 10,
    attempts: 0,
    owner_user_id: OWNER,
    local_rev: 1,
    created_at: "2026-09-19T10:00:00.000Z",
    cached_at: "2026-09-19T11:00:00.000Z",
    ...partial,
  };
}

async function seedV7(name: string): Promise<void> {
  const legacy = new LifeLogDBv7(name);
  try {
    await legacy.entries.bulkPut([
      pendingEntry({ id: "e-pending", encrypted_content: "ct-pending" }),
      pendingEntry({
        id: "e-orphan",
        owner_user_id: undefined,
        encrypted_content: "ct-orphan",
        encrypted_dek: "dek-orphan",
      }),
      pendingEntry({
        id: "e-delete",
        status: "pending_delete",
        deleted: true,
        encrypted_content: "ct-delete",
        version: 3,
      }),
    ]);
    await legacy.life_queue.bulkPut([
      {
        id: "g-conflict",
        kind: "goal",
        payload: {
          id: "g-conflict",
          encrypted_content: "local-goal",
          encrypted_dek: "d",
          created_at: "2026-08-01T00:00:00.000Z",
          cached_at: "2026-08-02T00:00:00.000Z",
        },
        status: "conflict",
        owner_user_id: OWNER,
        queued_at: 20,
        local_rev: 2,
        server_version: 4,
        conflict_version: 5,
        server_snapshot: { id: "g-conflict", encrypted_content: "server-goal", version: 5 },
      },
      {
        id: "a1",
        kind: "action",
        payload: { id: "a1", encrypted_content: "plan-v3", encrypted_dek: "d", state: "accepted" },
        status: "pending",
        owner_user_id: OWNER,
        queued_at: 30,
        local_rev: 3,
        server_version: 2,
      },
      {
        id: "fb-partial",
        kind: "feedback",
        payload: { id: "fb-partial", encrypted_content: "fb-v1", encrypted_dek: "d", action_id: "a1" },
        status: "synced",
        owner_user_id: OWNER,
        queued_at: 31,
        local_rev: 1,
        server_version: 1,
      },
      {
        id: "fb-corr",
        kind: "feedback",
        payload: { id: "fb-corr", encrypted_content: "corr-v1", encrypted_dek: "d", action_id: "a1" },
        status: "pending",
        owner_user_id: OWNER,
        queued_at: 32,
        local_rev: 2,
      },
      {
        id: "fb-done",
        kind: "feedback",
        payload: { id: "fb-done", encrypted_content: "done-ct", encrypted_dek: "d", action_id: "a-done" },
        status: "synced",
        owner_user_id: OWNER,
        queued_at: 33,
        local_rev: 1,
        server_version: 1,
      },
      {
        id: "a-done",
        kind: "action",
        payload: { id: "a-done", encrypted_content: "done-plan", encrypted_dek: "d", state: "completed" },
        status: "synced",
        owner_user_id: OWNER,
        queued_at: 34,
        local_rev: 1,
        server_version: 5,
      },
    ]);
    const ops: LifeOp[] = [
      {
        id: "op-partial",
        owner_user_id: OWNER,
        session_id: 1,
        kind: "feedback_and_action",
        status: "feedback_acked",
        submission_id: "sub-partial",
        feedback_id: "fb-partial",
        action_id: "a1",
        expected_action_version: 2,
        expected_action_local_rev: 1,
        feedback_local_rev: 1,
        action_local_rev: 1,
        feedback_acked: true,
        action_acked: false,
        feedback_payload: { encrypted_content: "fb-v1", encrypted_dek: "d" },
        action_payload: { encrypted_content: "plan-v1", encrypted_dek: "d" },
        created_at: 100,
        status_seq: 2,
      },
      {
        id: "op-stale-rev",
        owner_user_id: OWNER,
        session_id: 1,
        kind: "feedback_and_action",
        status: "superseded",
        submission_id: "sub-stale",
        feedback_id: "fb-partial",
        action_id: "a1",
        action_local_rev: 1,
        feedback_local_rev: 1,
        feedback_acked: false,
        action_acked: false,
        feedback_payload: { encrypted_content: "fb-old", encrypted_dek: "d" },
        action_payload: { encrypted_content: "plan-v1", encrypted_dek: "d" },
        created_at: 90,
        status_seq: 1,
      },
      {
        id: "op-corr",
        owner_user_id: OWNER,
        session_id: 1,
        kind: "feedback_correction",
        status: "local",
        submission_id: "sub-corr",
        feedback_id: "fb-corr",
        action_id: "a1",
        feedback_local_rev: 2,
        action_local_rev: null,
        feedback_acked: false,
        action_acked: false,
        feedback_payload: { encrypted_content: "corr-v1", encrypted_dek: "d" },
        action_payload: null,
        created_at: 110,
        status_seq: 1,
      },
      {
        id: "op-done",
        owner_user_id: OWNER,
        session_id: 1,
        kind: "feedback_and_action",
        status: "done",
        submission_id: "sub-done",
        feedback_id: "fb-done",
        action_id: "a-done",
        feedback_local_rev: 1,
        action_local_rev: 1,
        feedback_acked: true,
        action_acked: true,
        feedback_payload: null,
        action_payload: null,
        created_at: 80,
        status_seq: 3,
      },
    ];
    await legacy.life_ops.bulkPut(ops);
  } finally {
    legacy.close();
  }
}

function assertCopied(notes: string[], cond: boolean, label: string): boolean {
  notes.push(`${label}=${cond}`);
  return cond;
}

export async function runV7toV8Upgrade(): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (typeof indexedDB === "undefined") return { ok: false, notes: ["indexedDB unavailable"] };
  const name = `lifelog-v8up-${crypto.randomUUID()}`;
  await seedV7(name);
  const current = new LifeLogDB(name);
  try {
    const entries = await listEntries(current);
    const life = await listLife(current);
    const ops = await listOps(current);
    const pending = await getEntry(current, "e-pending");
    const orphan = await getEntry(current, "e-orphan");
    const deleted = await getEntry(current, "e-delete");
    const goal = await getLife(current, "g-conflict");
    const action = await getLife(current, "a1");
    const partial = await getOp(current, "op-partial");
    const stale = await getOp(current, "op-stale-rev");
    const corr = await getOp(current, "op-corr");
    const done = await getOp(current, "op-done");

    let ok = true;
    ok = assertCopied(notes, entries.length === 3 && life.length === 6 && ops.length === 4, "counts") && ok;
    ok = assertCopied(notes, pending?.encrypted_content === "ct-pending" && pending.created_at === "2026-09-19T10:00:00.000Z" && pending.cached_at === "2026-09-19T11:00:00.000Z", "pending-iso") && ok;
    ok = assertCopied(notes, orphan?.owner_user_id == null && orphan?.encrypted_content === "ct-orphan", "orphan-unassigned") && ok;
    ok = assertCopied(notes, deleted?.status === "pending_delete" && deleted.encrypted_content === "ct-delete", "pending-delete") && ok;
    ok = assertCopied(notes, goal?.status === "conflict" && goal.server_snapshot?.encrypted_content === "server-goal" && goal.payload.encrypted_content === "local-goal", "life-conflict") && ok;
    ok = assertCopied(notes, (action?.local_rev ?? 0) === 3 && (stale?.action_local_rev ?? 0) === 1, "historical-rev") && ok;
    ok = assertCopied(notes, partial?.status === "feedback_acked" && partial.submission_id === "sub-partial" && partial.feedback_payload?.encrypted_content === "fb-v1" && partial.status_seq === 2 && partial.created_at === 100, "partial-op") && ok;
    ok = assertCopied(notes, corr?.kind === "feedback_correction" && corr.feedback_payload?.encrypted_content === "corr-v1", "correction") && ok;
    ok = assertCopied(notes, done?.status === "done" && done.feedback_payload == null && done.action_payload == null, "done-stripped") && ok;
    ok = assertCopied(notes, (await current.entries.count()) === 3 && (await current.life_queue.count()) === 6 && (await current.life_ops.count()) === 4, "legacy-kept") && ok;

    current.close();
    const again = new LifeLogDB(name);
    try {
      const againPartial = await getOp(again, "op-partial");
      ok = assertCopied(notes, againPartial?.submission_id === "sub-partial" && againPartial.feedback_payload?.encrypted_content === "fb-v1", "reopen") && ok;

      const historical = await getOp(again, "op-partial");
      if (historical?.action_local_rev != null && historical.action_payload) {
        await applyLifeResult(
          {
            id: "a1",
            owner: OWNER,
            kind: "action",
            local_rev: historical.action_local_rev,
            payload: historical.action_payload,
            status: "pending",
          },
          { status: "updated", version: 6 },
          again,
        );
      } else {
        const claimed = await claimLifeForSend(OWNER, again);
        const actSnap = claimed.find((row) => row.id === "a1");
        if (actSnap) await applyLifeResult(actSnap, { status: "updated", version: 6 }, again);
      }
      await refreshLifeOpStatus(OWNER, again);
      const delivered = await getOp(again, "op-partial");
      ok = assertCopied(notes, delivered?.status === "done", "open-op-done") && ok;
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

class AbortingV8 extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({ entries: "id, status, entry_type, timestamp, queued_at" });
    this.version(2).stores({ entries: "id, status, entry_type, timestamp, queued_at, skill_id, habit_id" });
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
    this.version(6).stores({ life_ops: "id, owner_user_id, action_id, status" });
    this.version(7).stores({ life_ops: "id, owner_user_id, action_id, status, submission_id" });
    this.version(8)
      .stores({ outbox: OUTBOX_STORE })
      .upgrade(async () => {
        throw new Error("outbox_copy_failed");
      });
  }
}

export async function runV8UpgradeAbort(): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (typeof indexedDB === "undefined") return { ok: false, notes: ["indexedDB unavailable"] };
  const name = `lifelog-v8abort-${crypto.randomUUID()}`;
  await seedV7(name);
  const failing = new AbortingV8(name);
  let aborted = false;
  try {
    await failing.open();
  } catch (e) {
    aborted = (e as Error).message.includes("outbox_copy_failed") || (e as Error).name === "AbortError" || Boolean(e);
    notes.push(`upgrade-error=${(e as Error).message}`);
  } finally {
    failing.close();
  }
  const v7 = new LifeLogDBv7(name);
  try {
    const pending = await v7.entries.get("e-pending");
    const op = await v7.life_ops.get("op-partial");
    const hasOutbox = v7.tables.some((table) => table.name === "outbox");
    const ok = aborted && pending?.encrypted_content === "ct-pending" && op?.submission_id === "sub-partial" && !hasOutbox;
    notes.push(`readable-v7=${Boolean(pending)} outbox-present=${hasOutbox}`);
    return { ok: Boolean(ok), notes };
  } finally {
    v7.close();
    await Dexie.delete(name);
  }
}

export async function runV8OldTab(): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (typeof indexedDB === "undefined") return { ok: false, notes: ["indexedDB unavailable"] };
  const name = `lifelog-v8tab-${crypto.randomUUID()}`;
  await seedV7(name);
  const oldTab = new LifeLogDBv7(name);
  await oldTab.open();
  let versionchange = false;
  let wroteAfter = false;
  oldTab.on("versionchange", () => {
    versionchange = true;
    oldTab.close();
  });
  const next = new LifeLogDB(name);
  try {
    await next.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const closed = !oldTab.isOpen();
    try {
      await oldTab.entries.put(pendingEntry({ id: "e-after", encrypted_content: "should-fail" }));
      wroteAfter = true;
    } catch {
      wroteAfter = false;
    }
    const copied = await getEntry(next, "e-pending");
    const leaked = await getEntry(next, "e-after");
    const ok = versionchange && closed && !leaked && copied?.encrypted_content === "ct-pending";
    notes.push(`versionchange=${versionchange} closed=${closed} wroteAfter=${wroteAfter} leaked=${Boolean(leaked)}`);
    return { ok: Boolean(ok), notes };
  } catch (e) {
    notes.push((e as Error).message);
    return { ok: false, notes };
  } finally {
    oldTab.close();
    next.close();
    await Dexie.delete(name);
  }
}

export async function runOutboxUpgradeSuite(): Promise<{ ok: boolean; notes: string[] }> {
  const parts = [await runV7toV8Upgrade(), await runV8UpgradeAbort(), await runV8OldTab()];
  return {
    ok: parts.every((part) => part.ok),
    notes: parts.flatMap((part) => part.notes),
  };
}

export { isOutboxEntity, isOutboxOperation, operationKey };
