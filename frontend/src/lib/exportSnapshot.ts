import { exportDecryptedTurns } from "../agent/chatStore.ts";
import { db } from "../db/offlineQueue.ts";
import { api, type EntryRead, type LifeBundle } from "./api.ts";
import { decryptEntry } from "./crypto.ts";
import { collectArrayPages } from "./paging.ts";
import { mergeExportEntries, mergeExportLife } from "./exportMerge.ts";
import { getCurrentUserId, getSessionId, isCurrentSession, isEncryptAllowed } from "./accountScope.ts";

export { mergeExportEntries, mergeExportLife };

export const EXPORT_FORMAT_VERSION = 2;

export class ExportCancelledError extends Error {
  constructor() {
    super("export_cancelled_account_changed");
    this.name = "ExportCancelledError";
  }
}

export interface ExportEntryRow {
  id: string;
  source: "server" | "local";
  sync_status: string;
  plaintext?: unknown;
  decrypt_error?: boolean;
  variants?: { local?: unknown; server?: unknown };
  conflict_note?: string;
  [key: string]: unknown;
}

function stripCipher<T extends { encrypted_content?: string; encrypted_dek?: string }>(row: T) {
  const { encrypted_content: _c, encrypted_dek: _d, ...rest } = row;
  return rest;
}

function assertExportLive(owner: string, sessionId: number): void {
  if (!isCurrentSession(sessionId) || getCurrentUserId() !== owner || !isEncryptAllowed()) {
    throw new ExportCancelledError();
  }
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

interface SectionStats {
  loaded: number;
  exported: number;
  decrypted: number;
  failed: number;
}

function emptyStats(): SectionStats {
  return { loaded: 0, exported: 0, decrypted: 0, failed: 0 };
}

export async function buildFullExport(args: {
  token: string | null;
  kek: CryptoKey;
  userId: string;
  timezone: string;
}): Promise<Record<string, unknown>> {
  const sessionId = getSessionId();
  assertExportLive(args.userId, sessionId);

  const sections: Record<string, SectionStats> = {
    entries: emptyStats(),
    goals: emptyStats(),
    memory: emptyStats(),
    actions: emptyStats(),
    feedback: emptyStats(),
    chat: emptyStats(),
  };
  const errors: { section: string; id?: string; reason: string }[] = [];
  const incomplete: string[] = [];

  let serverEntries: EntryRead[] = [];
  let pages = 0;
  if (args.token) {
    try {
      const listed = await collectArrayPages((offset, limit) => api.listEntries(args.token!, { limit, offset }), 200);
      serverEntries = listed.items;
      pages = listed.pages;
      sections.entries.loaded = listed.items.length;
    } catch (e) {
      incomplete.push("entries_api");
      errors.push({ section: "entries", reason: (e as Error).message });
    }
  } else {
    incomplete.push("entries_api");
  }
  assertExportLive(args.userId, sessionId);

  let serverLife: LifeBundle | undefined;
  if (args.token) {
    try {
      serverLife = await api.getLife(args.token);
      sections.goals.loaded = serverLife.goals.length;
      sections.memory.loaded = serverLife.memory.length;
      sections.actions.loaded = serverLife.actions.length;
      sections.feedback.loaded = serverLife.feedback.length;
    } catch (e) {
      incomplete.push("life_api");
      errors.push({ section: "life", reason: (e as Error).message });
    }
  } else {
    incomplete.push("life_api");
  }
  assertExportLive(args.userId, sessionId);

  let entryTombs: { id: string; deleted_at: string; version?: number }[] = [];
  let lifeTombs: { id: string; kind: string; deleted_at: string; version?: number }[] = [];
  if (args.token) {
    try {
      entryTombs = (await api.getEntryTombstones(args.token)).items;
    } catch (e) {
      incomplete.push("entry_tombstones");
      errors.push({ section: "entry_tombstones", reason: (e as Error).message });
    }
    try {
      lifeTombs = (await api.getLifeTombstones(args.token)).items;
    } catch (e) {
      incomplete.push("life_tombstones");
      errors.push({ section: "life_tombstones", reason: (e as Error).message });
    }
  }
  assertExportLive(args.userId, sessionId);

  const localEntries = await db.entries.toArray();
  const localLife = await db.life_queue.toArray();
  assertExportLive(args.userId, sessionId);

  const tombstoneIds = new Set(entryTombs.map((item) => item.id));
  const merged = mergeExportEntries(serverEntries, localEntries, args.userId, tombstoneIds);
  const entries: ExportEntryRow[] = [];
  for (const item of merged) {
    const base = { ...stripCipher(item.row as EntryRead), source: item.source, sync_status: item.sync_status };
    const row = item.row as EntryRead;
    const dec =
      row.encrypted_dek && row.encrypted_content
        ? await decryptPlain(row as unknown as Record<string, unknown>, args.kek)
        : {};
    if (dec.decrypt_error) {
      sections.entries.failed += 1;
      errors.push({ section: "entries", id: item.id, reason: "decrypt_failed" });
    } else if (dec.plaintext !== undefined) {
      sections.entries.decrypted += 1;
    }
    sections.entries.exported += 1;
    const variants =
      item.sync_status === "conflict"
        ? {
            local: dec.plaintext ?? null,
            server: item.server_variant ?? null,
            note: "Both variants kept until the user chooses. Texts were not auto-merged.",
          }
        : undefined;
    entries.push({
      ...base,
      id: item.id,
      plaintext: dec.plaintext,
      decrypt_error: dec.decrypt_error,
      variants,
      conflict_note: variants ? "local_and_server_kept" : undefined,
    });
    assertExportLive(args.userId, sessionId);
  }

  const lifeTombIds = new Set(lifeTombs.map((item) => item.id));
  const life = mergeExportLife(serverLife, localLife, args.userId, lifeTombIds);
  const lifeOut: Record<string, Record<string, unknown>[]> = { goal: [], memory: [], action: [], feedback: [] };
  const kindToSection = { goal: "goals", memory: "memory", action: "actions", feedback: "feedback" } as const;
  for (const kind of ["goal", "memory", "action", "feedback"] as const) {
    const section = kindToSection[kind];
    for (const row of life[kind]) {
      const dec = await decryptPlain(row, args.kek);
      if (dec.decrypt_error) {
        sections[section].failed += 1;
        errors.push({ section, id: String(row.id), reason: "decrypt_failed" });
      } else if (dec.plaintext !== undefined) {
        sections[section].decrypted += 1;
      }
      sections[section].exported += 1;
      const variants =
        row.sync_status === "conflict"
          ? {
              local: dec.plaintext ?? null,
              server: row.server_variant ?? null,
              note: "Both variants kept until the user chooses.",
            }
          : undefined;
      lifeOut[kind].push({ ...stripCipher(row as never), ...dec, variants });
      assertExportLive(args.userId, sessionId);
    }
  }

  const chat = await exportDecryptedTurns(args.kek, args.userId);
  assertExportLive(args.userId, sessionId);
  sections.chat.loaded = chat.loaded;
  sections.chat.exported = chat.turns.length;
  sections.chat.failed = chat.failed;
  sections.chat.decrypted = chat.turns.length - chat.failed;

  const pending = localEntries.filter(
    (row) =>
      row.owner_user_id === args.userId &&
      ["pending", "error", "rejected", "conflict", "pending_delete"].includes(row.status),
  );
  const completeness = incomplete.length === 0 ? "complete" : "partial";
  return {
    format_version: EXPORT_FORMAT_VERSION,
    generated_at: new Date().toISOString(),
    timezone: args.timezone,
    owner_user_id: args.userId,
    completeness,
    incomplete_sections: incomplete,
    chat_scope: "this_device_only",
    entries,
    goals: lifeOut.goal,
    memory: lifeOut.memory,
    actions: lifeOut.action,
    feedback: lifeOut.feedback,
    tombstones: { entries: entryTombs, life: lifeTombs },
    chat_turns: chat.turns,
    queue: {
      entries: pending.map((row) => ({
        id: row.id,
        status: row.status,
        last_error: row.last_error,
        local_rev: row.local_rev,
      })),
      life: localLife
        .filter((row) => row.owner_user_id === args.userId && row.status !== "synced")
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          last_error: row.last_error,
          local_rev: row.local_rev,
        })),
    },
    report: {
      completeness,
      format_version: EXPORT_FORMAT_VERSION,
      chat_this_device_only: true,
      entry_pages: pages,
      sections,
      errors,
      sync_status: {
        pending: pending.filter((r) => r.status === "pending").length,
        conflict: pending.filter((r) => r.status === "conflict").length,
        rejected: pending.filter((r) => r.status === "rejected").length,
        pending_delete: pending.filter((r) => r.status === "pending_delete").length,
      },
    },
  };
}
