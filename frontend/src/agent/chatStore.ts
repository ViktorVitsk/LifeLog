import { db } from "../db/offlineQueue.ts";
import { decryptEntry, encryptEntry } from "../lib/crypto.ts";
import { getCurrentUserId, requireCurrentUserId } from "../lib/accountScope.ts";
import { localDayKey } from "../lib/dates.ts";
import type { ThreadMessage } from "./types.ts";

export async function saveThreadMessage(msg: ThreadMessage, kek: CryptoKey): Promise<void> {
  const owner = requireCurrentUserId();
  const { encryptedContent, encryptedDek } = await encryptEntry(JSON.stringify(msg), kek);
  await db.chat_turns.put({
    id: msg.id,
    day: localDayKey(new Date(msg.created_at)),
    created_at: msg.created_at,
    encrypted_content: encryptedContent,
    encrypted_dek: encryptedDek,
    owner_user_id: owner,
  });
}

export async function loadThreadForDay(kek: CryptoKey, day = localDayKey()): Promise<ThreadMessage[]> {
  const owner = getCurrentUserId();
  if (!owner) return [];
  const rows = await db.chat_turns.where("day").equals(day).sortBy("created_at");
  const out: ThreadMessage[] = [];
  for (const row of rows) {
    if (row.owner_user_id !== owner) continue;
    try {
      const raw = await decryptEntry(row.encrypted_content, row.encrypted_dek, kek);
      const parsed = JSON.parse(raw) as ThreadMessage;
      if (parsed && parsed.id && parsed.role) out.push(parsed);
    } catch {
      /* skip undecryptable */
    }
  }
  return out;
}

export async function exportDecryptedTurns(kek: CryptoKey): Promise<ThreadMessage[]> {
  const owner = getCurrentUserId();
  const rows = await db.chat_turns.orderBy("created_at").toArray();
  const out: ThreadMessage[] = [];
  for (const row of rows) {
    if (owner && row.owner_user_id !== owner) continue;
    try {
      const raw = await decryptEntry(row.encrypted_content, row.encrypted_dek, kek);
      out.push(JSON.parse(raw) as ThreadMessage);
    } catch {
      out.push({
        id: row.id,
        role: "assistant",
        content: "",
        created_at: row.created_at,
      });
    }
  }
  return out;
}

export async function listPinnedCharts(): Promise<{ id: string; spec_json: string }[]> {
  const owner = getCurrentUserId();
  if (!owner) return [];
  const rows = await db.pinned_charts.orderBy("created_at").reverse().toArray();
  return rows.filter((r) => r.owner_user_id === owner);
}

export async function pinChartSpec(spec_json: string): Promise<string> {
  const owner = requireCurrentUserId();
  const id = crypto.randomUUID();
  await db.pinned_charts.put({ id, created_at: Date.now(), spec_json, owner_user_id: owner });
  return id;
}
