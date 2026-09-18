import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { attachOrphansToUser, db, deleteOrphanEntries, listOrphanEntries } from "../db/offlineQueue";
import { tryUnwrapDek } from "../lib/crypto";

export default function OrphanRecovery() {
  const { kek, userId } = useAuth();
  const { t } = useLocale();
  const orphans = useLiveQuery(() => listOrphanEntries(), [], []);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!orphans?.length) return null;

  async function attach() {
    if (!kek || !userId) return;
    setBusy(true);
    setMsg(null);
    try {
      const ids: string[] = [];
      for (const row of orphans) {
        if (await tryUnwrapDek(row.encrypted_dek, kek)) ids.push(row.id);
      }
      if (ids.length === 0) {
        setMsg(t.orphanNoneDecrypt);
        return;
      }
      const n = await attachOrphansToUser(userId, ids);
      const chats = await db.chat_turns.toArray();
      for (const c of chats) {
        if (!c.owner_user_id && (await tryUnwrapDek(c.encrypted_dek, kek))) {
          await db.chat_turns.update(c.id, { owner_user_id: userId });
        }
      }
      setMsg(`${t.orphanAttached}${n}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteOrphanEntries(orphans.map((r) => r.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-900/80 bg-amber-950/30 p-3 space-y-2 text-sm">
      <div className="font-medium text-amber-100">{t.orphanTitle}</div>
      <p className="text-xs text-amber-50/80">{t.orphanBody}</p>
      <p className="text-xs text-zinc-400">{orphans.length}</p>
      {msg && <p className="text-xs text-zinc-200">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !kek}
          onClick={() => void attach()}
          className="min-h-[44px] px-3 rounded bg-indigo-600 text-sm disabled:opacity-40"
        >
          {t.orphanAttach}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="min-h-[44px] px-3 rounded border border-zinc-600 text-sm"
        >
          {t.orphanDelete}
        </button>
      </div>
    </div>
  );
}
