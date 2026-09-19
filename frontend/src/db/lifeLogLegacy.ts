import Dexie, { type EntityTable } from "dexie";
import type { LifeOp, PendingEntry, PendingLife, StoredChatTurn, StoredKekVerifier, StoredLlmSettings, StoredPinnedChart } from "./offlineQueue.ts";

/** Schema frozen at Dexie v7 so tests can seed legacy rows before opening v8. */
export class LifeLogDBv7 extends Dexie {
  entries!: EntityTable<PendingEntry, "id">;
  chat_turns!: EntityTable<StoredChatTurn, "id">;
  llm_settings!: EntityTable<StoredLlmSettings, "id">;
  pinned_charts!: EntityTable<StoredPinnedChart, "id">;
  kek_verifiers!: EntityTable<StoredKekVerifier, "owner_user_id">;
  life_queue!: EntityTable<PendingLife, "id">;
  life_ops!: EntityTable<LifeOp, "id">;

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
      life_ops: "id, owner_user_id, action_id, status",
    });
    this.version(7)
      .stores({
        life_ops: "id, owner_user_id, action_id, status, submission_id",
      })
      .upgrade((tx) =>
        tx
          .table("life_ops")
          .toCollection()
          .modify((row) => {
            delete (row as { intent_key?: string }).intent_key;
            if (!(row as { submission_id?: string }).submission_id) {
              (row as { submission_id?: string }).submission_id = String((row as { id?: string }).id ?? "");
            }
            if ((row as { kind?: string }).kind !== "feedback_correction") {
              (row as { kind?: string }).kind = "feedback_and_action";
            }
          }),
      );
  }
}
