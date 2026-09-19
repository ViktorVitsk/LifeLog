import { exportDecryptedTurns, type ExportedChatTurn } from "../agent/chatStore.ts";
import { db, type LifeLogDB, type LifeOp, type PendingEntry, type PendingLife } from "../db/offlineQueue.ts";
import type { EntryRead, LifeBundle } from "./api.ts";
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
  variants?: { local?: unknown; server?: unknown; note?: string };
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
  row: Record<string, unknown> | null | undefined,
  kek: CryptoKey,
): Promise<{ plaintext: unknown | null; decrypt_error?: boolean; attempted: boolean }> {
  const dek = row?.encrypted_dek;
  const ct = row?.encrypted_content;
  if (typeof dek !== "string" || typeof ct !== "string") {
    return { plaintext: null, attempted: false };
  }
  try {
    return { plaintext: JSON.parse(await decryptEntry(ct, dek, kek)), attempted: true };
  } catch {
    return { plaintext: null, decrypt_error: true, attempted: true };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function exportedVariant(dec: Awaited<ReturnType<typeof decryptPlain>>) {
  return {
    plaintext: dec.decrypt_error ? null : dec.plaintext,
    decrypt_error: dec.decrypt_error === true,
  };
}

function recordDecrypt(
  stats: SectionStats,
  errors: { section: string; id?: string; reason: string }[],
  section: string,
  id: string,
  dec: Awaited<ReturnType<typeof decryptPlain>>,
): void {
  if (!dec.attempted) return;
  if (dec.decrypt_error) {
    stats.failed += 1;
    errors.push({ section, id, reason: "decrypt_failed" });
    return;
  }
  stats.decrypted += 1;
}

function exportOpMeta(op: LifeOp) {
  return {
    id: op.id,
    owner_user_id: op.owner_user_id,
    kind: op.kind,
    status: op.status,
    submission_id: op.submission_id,
    feedback_id: op.feedback_id,
    action_id: op.action_id,
    feedback_local_rev: op.feedback_local_rev ?? null,
    action_local_rev: op.action_local_rev ?? null,
    feedback_acked: Boolean(op.feedback_acked),
    action_acked: Boolean(op.action_acked),
    created_at: op.created_at,
    status_seq: op.status_seq ?? 0,
  };
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

export interface ExportSources {
  listEntries?: (offset: number, limit: number) => Promise<EntryRead[]>;
  getLife?: () => Promise<LifeBundle>;
  getEntryTombstones?: () => Promise<{ items: { id: string; deleted_at: string; version?: number }[] }>;
  getLifeTombstones?: () => Promise<{ items: { id: string; kind: string; deleted_at: string; version?: number }[] }>;
  localEntries?: PendingEntry[];
  localLife?: PendingLife[];
  lifeOps?: LifeOp[];
  exportChat?: (
    kek: CryptoKey,
    userId: string,
  ) => Promise<{ turns: ExportedChatTurn[]; failed: number; loaded: number }>;
}

export async function buildFullExport(args: {
  token: string | null;
  kek: CryptoKey;
  userId: string;
  timezone: string;
  store?: LifeLogDB;
  sources?: ExportSources;
  pageLimit?: number;
}): Promise<Record<string, unknown>> {
  const sessionId = getSessionId();
  assertExportLive(args.userId, sessionId);
  const store = args.store ?? db;
  const sources = args.sources ?? {};
  const pageLimit = args.pageLimit ?? 200;

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
  const listEntries =
    sources.listEntries ??
    (args.token
      ? async (offset: number, limit: number) => {
          const { api } = await import("./api.ts");
          return api.listEntries(args.token!, { limit, offset });
        }
      : null);
  if (listEntries) {
    try {
      const listed = await collectArrayPages(listEntries, pageLimit);
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
  const getLife =
    sources.getLife ??
    (args.token
      ? async () => {
          const { api } = await import("./api.ts");
          return api.getLife(args.token!);
        }
      : null);
  if (getLife) {
    try {
      serverLife = await getLife();
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
  const getEntryTombs =
    sources.getEntryTombstones ??
    (args.token
      ? async () => {
          const { api } = await import("./api.ts");
          return api.getEntryTombstones(args.token!);
        }
      : null);
  const getLifeTombs =
    sources.getLifeTombstones ??
    (args.token
      ? async () => {
          const { api } = await import("./api.ts");
          return api.getLifeTombstones(args.token!);
        }
      : null);
  if (getEntryTombs) {
    try {
      entryTombs = (await getEntryTombs()).items;
    } catch (e) {
      incomplete.push("entry_tombstones");
      errors.push({ section: "entry_tombstones", reason: (e as Error).message });
    }
  }
  if (getLifeTombs) {
    try {
      lifeTombs = (await getLifeTombs()).items;
    } catch (e) {
      incomplete.push("life_tombstones");
      errors.push({ section: "life_tombstones", reason: (e as Error).message });
    }
  }
  assertExportLive(args.userId, sessionId);

  const localEntries = sources.localEntries ?? (await store.entries.toArray());
  const localLife = sources.localLife ?? (await store.life_queue.toArray());
  const lifeOps = sources.lifeOps ?? (await store.life_ops.toArray());
  assertExportLive(args.userId, sessionId);

  const tombstoneIds = new Set(entryTombs.map((item) => item.id));
  const merged = mergeExportEntries(serverEntries, localEntries, args.userId, tombstoneIds);
  const entries: ExportEntryRow[] = [];
  for (const item of merged) {
    const base = { ...stripCipher(item.row as EntryRead), source: item.source, sync_status: item.sync_status };
    const row = asRecord(item.row) ?? {};
    const localDec = await decryptPlain(row, args.kek);
    recordDecrypt(sections.entries, errors, "entries", item.id, localDec);
    let variants: ExportEntryRow["variants"];
    if (item.sync_status === "conflict") {
      const serverDec = await decryptPlain(asRecord(item.server_variant), args.kek);
      recordDecrypt(sections.entries, errors, "entries", `${item.id}:server`, serverDec);
      variants = {
        local: exportedVariant(localDec),
        server: exportedVariant(serverDec),
        note: "Both variants kept until the user chooses. Texts were not auto-merged.",
      };
    }
    sections.entries.exported += 1;
    entries.push({
      ...base,
      id: item.id,
      plaintext: localDec.decrypt_error ? null : localDec.plaintext,
      decrypt_error: localDec.decrypt_error,
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
      const localDec = await decryptPlain(row, args.kek);
      recordDecrypt(sections[section], errors, section, String(row.id), localDec);
      let variants: Record<string, unknown> | undefined;
      if (row.sync_status === "conflict") {
        const serverDec = await decryptPlain(asRecord(row.server_variant), args.kek);
        recordDecrypt(sections[section], errors, section, `${String(row.id)}:server`, serverDec);
        variants = {
          local: exportedVariant(localDec),
          server: exportedVariant(serverDec),
          note: "Both variants kept until the user chooses.",
        };
      }
      sections[section].exported += 1;
      const rest = { ...row };
      delete rest.server_variant;
      lifeOut[kind].push({
        ...stripCipher(rest as never),
        plaintext: localDec.decrypt_error ? null : localDec.plaintext,
        decrypt_error: localDec.decrypt_error,
        variants,
      });
      assertExportLive(args.userId, sessionId);
    }
  }

  const chat = sources.exportChat
    ? await sources.exportChat(args.kek, args.userId)
    : await exportDecryptedTurns(args.kek, args.userId);
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
  const operations = lifeOps
    .filter((op) => op.owner_user_id === args.userId)
    .map(exportOpMeta);
  if (operations.some((op) => op.status !== "done" && op.status !== "superseded")) {
    incomplete.push("open_life_ops");
  }
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
    operations,
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
      open_operations: operations.filter((op) => op.status !== "done" && op.status !== "superseded").length,
    },
  };
}
