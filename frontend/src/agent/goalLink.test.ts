import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { normalizeProposal } from "./normalizeProposal.ts";
import { commitProposedEntry } from "./commit.ts";
import { appConfirmation } from "./confirmation.ts";
import { validateProposalForSave } from "./proposalValidation.ts";
import { claimPendingEntries, db } from "../db/offlineQueue.ts";
import { getEntry } from "../db/outbox.ts";
import { deriveKEK, decryptEntry } from "../lib/crypto.ts";
import { setCurrentUserId, setEncryptAllowed } from "../lib/accountScope.ts";
import { resetTestDb } from "../test/resetDb.ts";

const GOAL = "11111111-1111-4111-8111-111111111111";
afterEach(async () => {
  await resetTestDb();
  setEncryptAllowed(false);
  setCurrentUserId(null);
});

it("preserves an allowed AI goal link through confirmation, encryption, outbox and wire payload", async () => {
  setCurrentUserId("fictional-owner");
  setEncryptAllowed(true);
  const p = normalizeProposal({ entry_type: "GOAL_UPDATE", goal_id: GOAL, goal_title: "Fictional demo goal", progress_pct: 25, reflection: "Fictional reflection", provenance: "user_stated" }, [], [], [{ id: GOAL }]);
  assert.ok(p);
  const kek = await deriveKEK("Fictional_test_only!", "ab".repeat(32));
  const meta = appConfirmation({ source: "entry_card", source_turn_id: "fictional-turn" });
  const { id } = await commitProposedEntry(p, kek, meta);
  const row = await getEntry(db, id);
  assert.equal(row?.goal_id, GOAL);
  assert.equal(row?.owner_user_id, "fictional-owner");
  assert.ok(row);
  const body = JSON.parse(await decryptEntry(row.encrypted_content, row.encrypted_dek, kek));
  assert.equal(body.reflection, "Fictional reflection");
  assert.equal(body.confirmation_event_id, meta.confirmation_event_id);
  const [sent] = await claimPendingEntries(10, "fictional-owner");
  assert.equal(sent.payload.goal_id, GOAL);
  assert.notEqual(sent.payload.encrypted_content, "Fictional reflection");
  assert.equal((await claimPendingEntries(10, "other-owner")).length, 0);
});

it("does not turn an unknown or invented model goal into a persisted link", async () => {
  const p = normalizeProposal({ entry_type: "GOAL_UPDATE", goal_id: "invented-goal", reflection: "Fictional" }, [], [], [{ id: GOAL }]);
  assert.ok(p);
  assert.equal(p.goal_id, undefined);
  assert.ok(p.issues?.some((i) => i.field === "goal_id" && i.message === "unknown_goal"));
  assert.ok(validateProposalForSave(p).some((i) => i.field === "goal_id"));
  const kek = await deriveKEK("Fictional_test_only!", "ab".repeat(32));
  await assert.rejects(commitProposedEntry(p, kek, appConfirmation({ source: "entry_card" })), /goal_id/);
  assert.equal((await db.outbox.toArray()).length, 0);
});
