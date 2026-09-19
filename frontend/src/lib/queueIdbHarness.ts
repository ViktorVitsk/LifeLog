import Dexie, { type EntityTable } from "dexie";
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
