import { db, type LifeLogDB } from "../db/offlineQueue.ts";

export async function resetTestDb(store: LifeLogDB = db): Promise<void> {
  await store.transaction(
    "rw",
    store.tables,
    async () => {
      await Promise.all([
        store.entries.clear(),
        store.chat_turns.clear(),
        store.llm_settings.clear(),
        store.pinned_charts.clear(),
        store.kek_verifiers.clear(),
        store.life_queue.clear(),
        store.life_ops.clear(),
        store.outbox.clear(),
      ]);
    },
  );
}
