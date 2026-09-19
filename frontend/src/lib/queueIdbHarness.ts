import Dexie, { type EntityTable } from "dexie";
import {
  applyEntryResult,
  claimPendingEntries,
  enqueueEntry,
  LifeLogDB,
  persistServerEntries,
} from "../db/offlineQueue.ts";
import { deriveKEK } from "./crypto.ts";
import { commitFeedbackDecision, findOpenFeedbackOp } from "./lifeOp.ts";
import { applyLifeResult, claimLifeForSend, enqueueLife, persistServerLife } from "./lifeQueue.ts";
import { getEntry, getLife, listLife } from "../db/outbox.ts";
import { applyRevisionAck } from "./queueAck.ts";

interface HarnessRow {
  id: string;
  owner_user_id: string;
  payload: string;
  local_rev: number;
  inflight_rev?: number;
  server_version?: number;
  status: "pending" | "synced";
}

class HarnessDB extends Dexie {
  rows!: EntityTable<HarnessRow, "id">;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ rows: "id" });
  }
}

/** Real IndexedDB race: claim a snapshot, then a later put must not be clobbered by the old ack. */
export async function runQueueIdbRace(): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (typeof indexedDB === "undefined") {
    return { ok: false, notes: ["indexedDB unavailable"] };
  }
  const name = `lifelog-qtest-${Date.now()}`;
  const db = new HarnessDB(name);
  try {
    await db.rows.put({
      id: "e1",
      owner_user_id: "a",
      payload: "A",
      local_rev: 1,
      server_version: 7,
      status: "pending",
    });
    const snapshot = await db.transaction("rw", db.rows, async () => {
      const row = await db.rows.get("e1");
      if (!row) throw new Error("missing");
      row.inflight_rev = row.local_rev;
      await db.rows.put(row);
      return { owner: row.owner_user_id, local_rev: row.local_rev, payload: row.payload };
    });
    notes.push(`claimed rev ${snapshot.local_rev} payload ${snapshot.payload}`);
    await db.transaction("rw", db.rows, async () => {
      const row = await db.rows.get("e1");
      if (!row) throw new Error("missing");
      row.payload = "B";
      row.local_rev = (row.local_rev ?? 0) + 1;
      await db.rows.put(row);
    });
    await db.transaction("rw", db.rows, async () => {
      const row = await db.rows.get("e1");
      if (!row) throw new Error("missing");
      const out = applyRevisionAck(row, snapshot, { kind: "success", version: 8 });
      if (!out.drop) await db.rows.put(out.row);
    });
    const final = await db.rows.get("e1");
    const ok = final?.payload === "B" && final.local_rev === 2 && final.server_version === 8 && final.status === "pending";
    notes.push(`final payload=${final?.payload} rev=${final?.local_rev} version=${final?.server_version} status=${final?.status}`);
    return { ok: Boolean(ok), notes };
  } finally {
    db.close();
    await Dexie.delete(name);
  }
}

/** Production queue functions on a throwaway IndexedDB — not the live tab store. */
export async function runProductionQueueIdb(): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (typeof indexedDB === "undefined") {
    return { ok: false, notes: ["indexedDB unavailable"] };
  }
  const name = `lifelog-iso-${crypto.randomUUID()}`;
  const iso = new LifeLogDB(name);
  const scope = { owner: "iso-owner", sessionId: 1 };
  try {
    await enqueueEntry(
      {
        id: "e1",
        timestamp: "2026-08-02T10:00:00.000Z",
        entry_type: "DAILY_CHECKIN",
        encrypted_dek: "d",
        encrypted_content: "A",
        tags: [],
        mood_score: 6,
      },
      scope,
      iso,
    );
    const claimed = await claimPendingEntries(10, "iso-owner", iso);
    notes.push(`claimed ${claimed.length} entry rev=${claimed[0]?.local_rev}`);
    await enqueueEntry(
      {
        id: "e1",
        timestamp: "2026-08-02T10:00:00.000Z",
        entry_type: "DAILY_CHECKIN",
        encrypted_dek: "d",
        encrypted_content: "B",
        tags: [],
        mood_score: 7,
      },
      scope,
      iso,
    );
    await applyEntryResult(claimed[0], { status: "updated", version: 8 }, iso);
    const afterAck = await getEntry(iso, "e1");
    const entryOk =
      afterAck?.encrypted_content === "B" &&
      afterAck.local_rev === 2 &&
      afterAck.version === 8 &&
      afterAck.status === "pending";
    notes.push(`entry after stale ack payload=${afterAck?.encrypted_content} rev=${afterAck?.local_rev} v=${afterAck?.version}`);

    const secondClaim = await claimPendingEntries(10, "iso-owner", iso);
    await applyEntryResult(secondClaim[0], { status: "updated", version: 8 }, iso);
    const synced = await getEntry(iso, "e1");
    notes.push(`entry synced status=${synced?.status} created=${synced?.created_at}`);
    const createdOk = Boolean(synced?.created_at);

    await persistServerEntries(
      [
        {
          id: "e1",
          timestamp: "2026-08-02T10:00:00.000Z",
          entry_type: "DAILY_CHECKIN",
          encrypted_dek: "d",
          encrypted_content: "OLD",
          tags: [],
          mood_score: 1,
          created_at: "2026-08-02T10:00:00.000Z",
          synced_from_offline: true,
          version: 7,
        },
      ],
      "iso-owner",
      iso,
    );
    const afterStale = await getEntry(iso, "e1");
    const staleOk = afterStale?.encrypted_content !== "OLD" && afterStale?.version === 8;
    notes.push(`stale persist kept v=${afterStale?.version} payload=${afterStale?.encrypted_content}`);

    await enqueueLife(
      "goal",
      {
        id: "g1",
        state: "active",
        encrypted_dek: "d",
        encrypted_content: "goal-v8",
        version: 8,
        created_at: "2026-08-01T00:00:00.000Z",
      },
      scope,
      iso,
    );
    const lifeClaim = await claimLifeForSend("iso-owner", iso);
    const goalSnap = lifeClaim.find((row) => row.id === "g1");
    if (goalSnap) await applyLifeResult(goalSnap, { status: "updated", version: 8 }, iso);
    await persistServerLife(
      {
        goals: [
          {
            id: "g1",
            state: "active",
            encrypted_dek: "d",
            encrypted_content: "goal-v7",
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-02T00:00:00.000Z",
            version: 7,
          },
        ],
        memory: [],
        actions: [],
        feedback: [],
        due_action_ids: [],
      },
      "iso-owner",
      iso,
    );
    const goal = await getLife(iso, "g1");
    const goalOk = goal?.payload.encrypted_content === "goal-v8" && (goal.server_version === 8 || goal.payload.version === 8);
    notes.push(`goal after stale server v=${goal?.server_version} ct=${String(goal?.payload.encrypted_content)}`);

    const kek = await deriveKEK("testdata1", "ab".repeat(16));
    await enqueueLife(
      "action",
      {
        id: "a1",
        goal_id: "g1",
        state: "accepted",
        encrypted_dek: "d",
        encrypted_content: "plan",
        version: 4,
        created_at: "2026-08-02T10:00:00.000Z",
      },
      scope,
      iso,
    );
    const actionSnap = (await claimLifeForSend("iso-owner", iso)).find((row) => row.id === "a1");
    if (actionSnap) await applyLifeResult(actionSnap, { status: "updated", version: 4 }, iso);
    let crashed = false;
    const actionRead = {
      id: "a1",
      goal_id: "g1",
      state: "accepted" as const,
      result_metric: null,
      period_start: null,
      period_end: null,
      review_at: "2026-09-26T12:00:00.000Z",
      encrypted_dek: "d",
      encrypted_content: "plan",
      version: 4,
      created_at: "2026-08-02T10:00:00.000Z",
      updated_at: "2026-09-01T10:00:00.000Z",
    };
    const fields = { what_changed: "нет эффекта", difficulty: "", side_effects: "", observed_on: "2026-09-19" };
    const submissionId = "iso-sub-1";
    try {
      await commitFeedbackDecision({
        kek,
        action: actionRead,
        outcome: "tried_no_effect",
        decision: "complete",
        fields,
        submissionId,
        scope,
        store: iso,
        afterLocal: async () => {
          throw new Error("crash_after_local");
        },
      });
    } catch (e) {
      crashed = (e as Error).message === "crash_after_local";
    }
    const open = await findOpenFeedbackOp("iso-owner", "a1", iso);
    const retry = await commitFeedbackDecision({
      kek,
      action: actionRead,
      outcome: "tried_no_effect",
      decision: "complete",
      fields,
      submissionId,
      scope,
      store: iso,
    });
    const feedbacks = (await listLife(iso)).filter((row) => row.kind === "feedback");
    const opOk = crashed && Boolean(open) && retry.reusedCipher && feedbacks.length === 1 && open?.feedback_id === retry.op.feedback_id;
    notes.push(`feedback crash=${crashed} reused=${retry.reusedCipher} n=${feedbacks.length} op=${open?.id}`);

    const ok = Boolean(entryOk && createdOk && staleOk && goalOk && opOk);
    return { ok, notes };
  } finally {
    iso.close();
    await Dexie.delete(name);
  }
}
