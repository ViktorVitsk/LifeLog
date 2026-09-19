import { exportDecryptedTurns } from "../agent/chatStore.ts";
import { db } from "../db/offlineQueue.ts";
import { api, type EntryRead } from "./api.ts";
import { decryptEntry } from "./crypto.ts";
import { collectArrayPages } from "./paging.ts";
import { mergeExportEntries, mergeExportLife } from "./exportMerge.ts";

export { mergeExportEntries, mergeExportLife };

export interface ExportEntryRow {
  id: string;
  source: "server" | "local";
  sync_status: string;
  plaintext?: unknown;
  decrypt_error?: boolean;
  [key: string]: unknown;
}

function stripCipher<T extends { encrypted_content?: string; encrypted_dek?: string }>(row: T) {
  const { encrypted_content: _c, encrypted_dek: _d, ...rest } = row;
  return rest;
}

async function decryptPlain(
  row: Record<string, unknown>,
  kek: CryptoKey,
): Promise<{ plaintext?: unknown; decrypt_error?: boolean }> {
  const dek = row.encrypted_dek;
  const ct = row.encrypted_content;
  if (typeof dek !== "string" || typeof ct !== "string") return {};
  try {
    return { plaintext: JSON.parse(await decryptEntry(ct, dek, kek)) };
  } catch {
    return { plaintext: null, decrypt_error: true };
  }
}

export async function buildFullExport(args: {
  token: string | null;
  kek: CryptoKey;
  userId: string;
  timezone: string;
}): Promise<Record<string, unknown>> {
  const listed = args.token
    ? await collectArrayPages((offset, limit) => api.listEntries(args.token!, { limit, offset }), 200)
    : { items: [] as EntryRead[], pages: 0 };
  const serverEntries = listed.items;
  const pages = listed.pages;
  const localEntries = await db.entries.toArray();
  const localLife = await db.life_queue.toArray();
  const serverLife = args.token ? await api.getLife(args.token).catch(() => undefined) : undefined;
  const merged = mergeExportEntries(serverEntries, localEntries, args.userId);
  const decrypt_errors: { id: string; reason: string }[] = [];
  const entries: ExportEntryRow[] = [];
  for (const item of merged) {
    const base = { ...stripCipher(item.row as EntryRead), source: item.source, sync_status: item.sync_status };
    const dek = (item.row as EntryRead).encrypted_dek;
    const ct = (item.row as EntryRead).encrypted_content;
    if (dek && ct) {
      try {
        const plaintext = JSON.parse(await decryptEntry(ct, dek, args.kek));
        entries.push({ ...base, id: item.id, plaintext });
      } catch {
        decrypt_errors.push({ id: item.id, reason: "decrypt_failed" });
        entries.push({ ...base, id: item.id, plaintext: null, decrypt_error: true });
      }
    } else {
      entries.push({ ...base, id: item.id });
    }
  }
  const life = mergeExportLife(serverLife, localLife, args.userId);
  const lifeOut: Record<string, Record<string, unknown>[]> = { goal: [], memory: [], action: [], feedback: [] };
  for (const kind of ["goal", "memory", "action", "feedback"] as const) {
    for (const row of life[kind]) {
      const dec = await decryptPlain(row, args.kek);
      if (dec.decrypt_error) decrypt_errors.push({ id: String(row.id), reason: "life_decrypt_failed" });
      lifeOut[kind].push({ ...stripCipher(row), ...dec });
    }
  }
  const chat = await exportDecryptedTurns(args.kek);
  const pending = localEntries.filter(
    (row) => row.owner_user_id === args.userId && ["pending", "error", "rejected", "conflict", "pending_delete"].includes(row.status),
  );
  return {
    generated_at: new Date().toISOString(),
    timezone: args.timezone,
    entries,
    goals: lifeOut.goal,
    memory: lifeOut.memory,
    actions: lifeOut.action,
    feedback: lifeOut.feedback,
    chat_turns: chat,
    queue: {
      entries: pending.map((row) => ({ id: row.id, status: row.status, last_error: row.last_error, local_rev: row.local_rev })),
      life: localLife
        .filter((row) => row.owner_user_id === args.userId && row.status !== "synced")
        .map((row) => ({ id: row.id, kind: row.kind, status: row.status, last_error: row.last_error, local_rev: row.local_rev })),
    },
    report: {
      entry_pages: pages,
      entry_count: entries.length,
      decrypt_ok: entries.length - decrypt_errors.length,
      decrypt_error_count: decrypt_errors.length,
      decrypt_errors,
      sync_status: {
        pending: pending.filter((r) => r.status === "pending").length,
        conflict: pending.filter((r) => r.status === "conflict").length,
        rejected: pending.filter((r) => r.status === "rejected").length,
        pending_delete: pending.filter((r) => r.status === "pending_delete").length,
      },
    },
  };
}
