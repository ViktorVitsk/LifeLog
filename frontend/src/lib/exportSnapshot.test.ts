import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { webcrypto } from "node:crypto";
import { mergeExportEntries, mergeExportLife } from "./exportMerge.ts";
import { buildFullExport } from "./exportSnapshot.ts";
import type { LifeOp, PendingEntry, PendingLife } from "../db/offlineQueue.ts";
import type { EntryRead } from "./api.ts";
import { setCurrentUserId, setEncryptAllowed } from "./accountScope.ts";
import { deriveKEK, encryptEntry } from "./crypto.ts";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

describe("full export merge", () => {
  it("does not resurrect a tombstoned entry from an stale local cache", () => {
    const local = {
      id: "dead",
      timestamp: "t",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "c",
      status: "synced",
      queued_at: 1,
      attempts: 0,
      owner_user_id: "u1",
    } as PendingEntry;
    const merged = mergeExportEntries(
      [{ id: "dead", timestamp: "t", entry_type: "THOUGHT", encrypted_dek: "d", encrypted_content: "c", created_at: "t", synced_from_offline: true }],
      [local],
      "u1",
      ["dead"],
    );
    assert.equal(merged.length, 0);
  });

  it("keeps a local synced copy that is missing from a server page", () => {
    const local = {
      id: "e1",
      timestamp: "t",
      entry_type: "THOUGHT",
      encrypted_dek: "d",
      encrypted_content: "c",
      status: "synced",
      queued_at: 1,
      attempts: 0,
      owner_user_id: "u1",
    } as PendingEntry;
    const merged = mergeExportEntries([], [local], "u1");
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "e1");
    assert.equal(merged[0].sync_status, "synced");
  });

  it("does not duplicate a pending overlay", () => {
    const server = [
      {
        id: "e1",
        timestamp: "t",
        entry_type: "THOUGHT",
        encrypted_dek: "old",
        encrypted_content: "old",
        created_at: "t",
        synced_from_offline: true,
      },
    ];
    const local = {
      id: "e1",
      timestamp: "t",
      entry_type: "THOUGHT",
      encrypted_dek: "new",
      encrypted_content: "new",
      status: "pending",
      queued_at: 2,
      attempts: 0,
      owner_user_id: "u1",
    } as PendingEntry;
    const merged = mergeExportEntries(server, [local], "u1");
    assert.equal(merged.length, 1);
    assert.equal(merged[0].sync_status, "pending");
  });

  it("lists pending_delete and rejected life rows explicitly", () => {
    const local: PendingLife[] = [
      {
        id: "g1",
        kind: "goal",
        payload: { state: "active" },
        status: "pending",
        owner_user_id: "u1",
        queued_at: 1,
      },
      {
        id: "m1",
        kind: "memory",
        payload: { state: "proposed" },
        status: "rejected",
        owner_user_id: "u1",
        queued_at: 1,
        last_error: "invalid_state",
      },
    ];
    const life = mergeExportLife(undefined, local, "u1");
    assert.equal(life.goal[0].sync_status, "pending");
    assert.equal(life.memory[0].sync_status, "rejected");
  });

  it("keeps both conflict variants and drops tombstoned cache rows", () => {
    const local: PendingLife[] = [
      {
        id: "g1",
        kind: "goal",
        payload: { state: "active", encrypted_content: "local" },
        status: "conflict",
        owner_user_id: "u1",
        queued_at: 1,
        server_snapshot: { state: "active", encrypted_content: "server" },
      },
      {
        id: "g2",
        kind: "goal",
        payload: { state: "active" },
        status: "synced",
        owner_user_id: "u1",
        queued_at: 1,
      },
    ];
    const life = mergeExportLife(
      { goals: [{ id: "g2" } as never], memory: [], actions: [], feedback: [], due_action_ids: [] },
      local,
      "u1",
      ["g2"],
    );
    assert.equal(life.goal.length, 1);
    assert.equal(life.goal[0].id, "g1");
    assert.equal(life.goal[0].sync_status, "conflict");
    assert.equal((life.goal[0].server_variant as { encrypted_content?: string })?.encrypted_content, "server");
    assert.equal(life.goal[0].conflict_note, "local_and_server_kept");
  });
});

describe("buildFullExport isolated snapshot", () => {
  afterEach(() => {
    setEncryptAllowed(false);
    setCurrentUserId(null);
  });

  it("keeps both conflict variants, page walks, API holes, and open ops without calling the snapshot complete", async () => {
    setCurrentUserId("u-export");
    setEncryptAllowed(true);
    const kek = await deriveKEK("testdata1", "ab".repeat(16));
    const enc = async (body: unknown) => {
      const raw = await encryptEntry(JSON.stringify(body), kek);
      return { encrypted_content: raw.encryptedContent, encrypted_dek: raw.encryptedDek };
    };
    const serverRow = async (id: string, notes: string): Promise<EntryRead> => {
      const cipher = await enc({ notes });
      return {
        id,
        timestamp: "2026-09-19T10:00:00.000Z",
        entry_type: "THOUGHT",
        tags: [],
        created_at: "2026-09-19T10:00:00.000Z",
        synced_from_offline: true,
        ...cipher,
      };
    };
    const localRow = (
      id: string,
      status: PendingEntry["status"],
      cipher: { encrypted_content: string; encrypted_dek: string },
      extra: Partial<PendingEntry> = {},
    ): PendingEntry => ({
      id,
      timestamp: "2026-09-19T10:00:00.000Z",
      entry_type: "THOUGHT",
      tags: [],
      status,
      queued_at: 2,
      attempts: 0,
      owner_user_id: "u-export",
      local_rev: 2,
      ...cipher,
      ...extra,
    });

    const pages = await Promise.all([
      serverRow("e-page-0", "PAGE_0"),
      serverRow("e-page-1", "PAGE_1"),
      serverRow("e-page-2", "PAGE_2"),
    ]);
    const bothLocal = await enc({ notes: "LOCAL_VARIANT" });
    const bothServer = await enc({ notes: "SERVER_VARIANT" });
    const goodLocal = await enc({ notes: "LOCAL_OK" });
    const pendingLocal = await enc({ notes: "LOCAL_EDIT" });
    const serverPages = [
      ...pages,
      { ...(await serverRow("e-both", "SERVER_VARIANT")), ...bothServer },
      { ...(await serverRow("e-bad", "SHOULD_NOT_WIN")), encrypted_content: "CORRUPT_CIPHERTEXT_NOT_PLAIN", encrypted_dek: "nope" },
    ];

    const snap = await buildFullExport({
      token: "t",
      kek,
      userId: "u-export",
      timezone: "Europe/Moscow",
      pageLimit: 2,
      sources: {
        listEntries: async (offset, limit) => serverPages.slice(offset, offset + limit),
        getLife: async () => {
          throw new Error("life_section_down");
        },
        getEntryTombstones: async () => ({ items: [] }),
        getLifeTombstones: async () => ({ items: [] }),
        exportChat: async () => ({ turns: [], failed: 0, loaded: 0 }),
        localEntries: [
          localRow("e-both", "conflict", bothLocal),
          localRow("e-bad", "conflict", goodLocal),
          localRow("e-pending", "pending", pendingLocal),
        ],
        localLife: [
          {
            id: "fb-open",
            kind: "feedback",
            payload: { encrypted_content: "x", encrypted_dek: "d", action_id: "a-open" },
            status: "pending",
            owner_user_id: "u-export",
            queued_at: 1,
            local_rev: 1,
          } satisfies PendingLife,
        ],
        lifeOps: [
          {
            id: "op-open",
            owner_user_id: "u-export",
            session_id: 1,
            kind: "feedback_and_action",
            status: "local",
            submission_id: "sub-open",
            feedback_id: "fb-open",
            action_id: "a-open",
            feedback_payload: { secret: "SECRET_OP_TEXT" },
            action_payload: { plan: "SECRET_OP_TEXT" },
            created_at: 10,
          } satisfies LifeOp,
        ],
      },
    });

    assert.equal(snap.completeness, "partial");
    assert.deepEqual(snap.incomplete_sections, ["life_api", "open_life_ops"]);
    const report = snap.report as { completeness: string; entry_pages: number; sections: { entries: { loaded: number; decrypted: number; failed: number } }; errors: { section: string }[]; open_operations: number };
    assert.equal(report.completeness, "partial");
    assert.equal(report.entry_pages, 3);
    assert.equal(report.sections.entries.loaded, 5);
    assert.equal(report.sections.entries.decrypted, 7);
    assert.equal(report.sections.entries.failed, 1);
    assert.equal(report.open_operations, 1);
    assert.equal(report.errors.some((item) => item.section === "life"), true);

    const entries = snap.entries as {
      id: string;
      plaintext?: { notes?: string } | null;
      encrypted_content?: string;
      variants?: { local?: { plaintext?: { notes?: string } | null; decrypt_error?: boolean }; server?: { plaintext?: { notes?: string } | null; decrypt_error?: boolean } };
    }[];
    const both = entries.find((row) => row.id === "e-both");
    assert.equal(both?.variants?.local?.plaintext?.notes, "LOCAL_VARIANT");
    assert.equal(both?.variants?.server?.plaintext?.notes, "SERVER_VARIANT");
    assert.equal(both?.variants?.local?.decrypt_error, false);
    assert.equal(both?.variants?.server?.decrypt_error, false);
    assert.equal(both?.encrypted_content, undefined);

    const bad = entries.find((row) => row.id === "e-bad");
    assert.equal(bad?.variants?.local?.plaintext?.notes, "LOCAL_OK");
    assert.equal(bad?.variants?.server?.decrypt_error, true);
    assert.equal(bad?.variants?.server?.plaintext, null);
    assert.equal(JSON.stringify(bad).includes("CORRUPT_CIPHERTEXT_NOT_PLAIN"), false);

    const pending = entries.find((row) => row.id === "e-pending");
    assert.equal(pending?.plaintext?.notes, "LOCAL_EDIT");
    const queue = snap.queue as { entries: { id: string; status: string }[] };
    assert.equal(queue.entries.some((row) => row.id === "e-pending" && row.status === "pending"), true);

    const ops = snap.operations as { id: string; status: string; submission_id: string }[];
    assert.equal(ops[0]?.id, "op-open");
    assert.equal(ops[0]?.status, "local");
    assert.equal(ops[0]?.submission_id, "sub-open");
    const opBlob = JSON.stringify({ operations: snap.operations, report: snap.report, queue: snap.queue });
    assert.equal(opBlob.includes("SECRET_OP_TEXT"), false);
    assert.equal(JSON.stringify(snap.entries).includes("SECRET_OP_TEXT"), false);
    assert.ok(pages.every((_, i) => entries.some((row) => row.id === `e-page-${i}` && row.plaintext?.notes === `PAGE_${i}`)));
  });
});
