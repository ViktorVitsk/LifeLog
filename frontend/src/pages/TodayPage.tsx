import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { listPinnedCharts, loadThreadForDay, saveThreadMessage } from "../agent/chatStore";
import { commitProposedEntry } from "../agent/commit";
import { appConfirmation } from "../agent/confirmation";
import { resolveContextEnvelope } from "../agent/contextEnvelope";
import { validateProposalForSave } from "../agent/proposalValidation";
import { runAgent } from "../agent/runtime";
import { loadLlmSettings } from "../agent/settingsStore";
import type {
  ChartSpec,
  ChatCompletionMessage,
  LlmSettings,
  ProposedEntry,
  ThreadMessage,
} from "../agent/types";
import { DEFAULT_LLM_SETTINGS } from "../agent/types";
import type { ToolRuntime } from "../agent/tools";
import Briefing from "../components/today/Briefing";
import ChartBlock from "../components/today/ChartBlock";
import Composer from "../components/today/Composer";
import EntryCard from "../components/today/EntryCard";
import ToolPill from "../components/today/ToolPill";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useSync } from "../context/SyncContext";
import { deleteLocalEntries } from "../db/offlineQueue";
import { useHabits, useSkills } from "../hooks/useCatalog";
import { useEntries } from "../hooks/useEntries";
import { useIsMdUp } from "../hooks/useIsMdUp";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { api } from "../lib/api";

export default function TodayPage() {
  const { kek, token, userId } = useAuth();
  const { locale, t } = useLocale();
  const sync = useSync();
  const qc = useQueryClient();
  const { entries } = useEntries();
  const md = useIsMdUp();
  const kb = useKeyboardInset();
  const tabBarVisible = !md && kb < 80;

  const skillsQ = useSkills();
  const habitsQ = useHabits();

  const [settings, setSettings] = useState<LlmSettings>({ ...DEFAULT_LLM_SETTINGS });
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tools, setTools] = useState<ThreadMessage["tools"]>([]);
  const [undo, setUndo] = useState<{ ids: string[]; until: number } | null>(null);
  const [pinned, setPinned] = useState<ChartSpec[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const threadRef = useRef<ThreadMessage[]>([]);
  threadRef.current = thread;
  const runGen = useRef(0);

  useEffect(() => {
    abortRef.current?.abort();
    runGen.current += 1;
    setThread([]);
    setDraft("");
    setTools([]);
    setErr(null);
    setBusy(false);
  }, [userId]);

  useEffect(() => {
    if (!kek || !userId) return;
    void loadLlmSettings(kek).then(setSettings);
    void loadThreadForDay(kek).then(setThread);
    void listPinnedCharts().then((rows) => {
      const specs: ChartSpec[] = [];
      for (const r of rows) {
        try {
          specs.push(JSON.parse(r.spec_json) as ChartSpec);
        } catch {
          /* skip */
        }
      }
      setPinned(specs);
    });
  }, [kek, userId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [thread, draft, tools]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [undo]);

  const persist = useCallback(
    async (msg: ThreadMessage) => {
      if (!kek) return;
      await saveThreadMessage(msg, kek);
    },
    [kek],
  );

  const persistChain = useRef(Promise.resolve());
  const persistLatest = useCallback(
    (msgId: string) => {
      persistChain.current = persistChain.current
        .catch(() => undefined)
        .then(async () => {
          const msg = threadRef.current.find((m) => m.id === msgId);
          if (msg && kek) await saveThreadMessage(msg, kek);
        });
      return persistChain.current;
    },
    [kek],
  );

  const skills = skillsQ.data ?? [];
  const habits = habitsQ.data ?? [];

  async function onSend(text: string) {
    if (!kek || !token || !settings) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setErr(null);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = runGen.current;

    const userMsg: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      created_at: Date.now(),
    };
    setThread((t) => [...t, userMsg]);
    await persist(userMsg);

    const history: ChatCompletionMessage[] = [...thread, userMsg]
      .filter((m) => m.content)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    const envelope = resolveContextEnvelope(settings);
    const rt: ToolRuntime = {
      kek,
      token,
      entries,
      skills: [...skills],
      habits: [...habits],
      settings,
      locale,
      sourceTurnId: userMsg.id,
      proposals: new Map(),
      charts: [],
      envelope,
      budget: {
        envelope,
        decryptedEntryIds: new Set(),
        audit: [],
        provider: settings.provider,
      },
    };

    setBusy(true);
    setDraft("");
    setTools([]);
    try {
      const result = await runAgent({
        settings,
        locale,
        history,
        userText: trimmed,
        rt,
        signal: ac.signal,
        onDelta: (d) => setDraft((s) => s + d),
        onTool: (name, status, detail) => {
          setTools((prev) => {
            const next = [...(prev ?? [])];
            if (status === "running") next.push({ name, status });
            else {
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].name === name && next[i].status === "running") {
                  next[i] = { name, status, detail };
                  break;
                }
              }
            }
            return next;
          });
        },
      });

      if (gen !== runGen.current) return;

      const asst: ThreadMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.assistantText || (result.proposals.length ? t.cardsReady : ""),
        created_at: Date.now(),
        source_user_turn_id: userMsg.id,
        proposals: result.proposals,
        charts: result.charts,
        committed_ids: [],
        tools: result.tools,
        context_audit: result.contextAudit,
      };
      setThread((t) => [...t, asst]);
      await persist(asst);
      setDraft("");
      setTools([]);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (gen !== runGen.current) return;
      setErr((e as Error).message);
    } finally {
      if (gen === runGen.current) setBusy(false);
    }
  }

  function rewriteMessage(msgId: string, patch: (m: ThreadMessage) => ThreadMessage) {
    let updated: ThreadMessage | undefined;
    const next = threadRef.current.map((m) => {
      if (m.id !== msgId) return m;
      updated = patch(m);
      return updated;
    });
    threadRef.current = next;
    setThread(next);
    return updated;
  }

  function patchProposal(msgId: string, next: ProposedEntry) {
    rewriteMessage(msgId, (m) => ({
      ...m,
      proposals: (m.proposals ?? []).map((p) => (p.id === next.id ? next : p)),
    }));
  }

  async function saveProposal(msgId: string, p: ProposedEntry) {
    if (!kek || !token || !userId) return;
    try {
      const host = threadRef.current.find((m) => m.id === msgId);
      const current = host?.proposals?.find((x) => x.id === p.id) ?? p;
      const issues = validateProposalForSave(current);
      if (issues.length) {
        setErr(t.cardFixFields);
        patchProposal(msgId, { ...current, issues });
        return;
      }
      let ready = current;
      if (ready.entry_type === "HABIT_LOG" && !ready.habit_id) {
        const name = ready.habit_name?.trim();
        if (!name) {
          setErr(t.needHabitName);
          return;
        }
        const existing = habits.find((h) => h.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) {
          ready = { ...ready, habit_id: existing.id, habit_name: existing.name };
        } else {
          const created = await api.createHabit(token, { name, frequency: "daily" });
          ready = { ...ready, habit_id: created.id, habit_name: created.name };
          await qc.invalidateQueries({ queryKey: ["habits", userId] });
        }
      }
      if (ready.entry_type === "SKILL_SESSION" && !ready.skill_id) {
        const name = ready.skill_name?.trim();
        if (!name) {
          setErr(t.needSkillName);
          return;
        }
        const existing = skills.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) {
          ready = { ...ready, skill_id: existing.id, skill_name: existing.name };
        } else {
          const created = await api.createSkill(token, { name });
          ready = { ...ready, skill_id: created.id, skill_name: created.name };
          await qc.invalidateQueries({ queryKey: ["skills", userId] });
        }
      }
      const meta = appConfirmation({
        source: "entry_card",
        source_turn_id: host?.source_user_turn_id ?? null,
      });
      const { id } = await commitProposedEntry(ready, kek, meta);
      setUndo({ ids: [id], until: Date.now() + 10_000 });
      const updated = rewriteMessage(msgId, (m) => ({
        ...m,
        proposals: (m.proposals ?? []).filter((x) => x.id !== p.id),
        committed_ids: [...(m.committed_ids ?? []), id],
      }));
      if (updated) await persistLatest(msgId);
      sync.trigger();
      await qc.invalidateQueries({ queryKey: ["entries", userId] });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function dismissProposal(msgId: string, id: string) {
    rewriteMessage(msgId, (m) => ({
      ...m,
      proposals: (m.proposals ?? []).filter((x) => x.id !== id),
    }));
    await persistLatest(msgId);
  }

  async function undoLast() {
    if (!undo) return;
    await deleteLocalEntries(undo.ids);
    setUndo(null);
    await qc.invalidateQueries({ queryKey: ["entries", userId] });
  }

  const needsSetup = settings.provider === "openrouter" && !settings.api_key;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 space-y-4">
        <Briefing entries={entries} skills={skills} habits={habits} pinned={pinned} />

        {needsSetup && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/30 text-amber-100 text-sm p-3">
            {t.needsSetup}
          </div>
        )}

        {thread.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
            {m.content ? (
              <div
                className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-900 border border-zinc-800 text-zinc-100"
                }`}
              >
                {m.content}
              </div>
            ) : null}
            {m.tools?.length ? (
              <div className="flex flex-wrap gap-1">
                {m.tools.map((t, i) => (
                  <ToolPill key={`${t.name}-${i}`} {...t} />
                ))}
              </div>
            ) : null}
            <ContextAuditLine audit={m.context_audit} />
            {m.charts?.map((c, i) => (
              <ChartBlock key={`${m.id}-c${i}`} spec={c} />
            ))}
            {(m.proposals ?? []).map((p) => (
              <EntryCard
                key={p.id}
                entry={p}
                habits={habits}
                skills={skills}
                onChange={(next) => patchProposal(m.id, next)}
                onSave={() => void saveProposal(m.id, p)}
                onDismiss={() => void dismissProposal(m.id, p.id)}
              />
            ))}
          </div>
        ))}

        {(busy || draft || (tools && tools.length > 0)) && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {(tools ?? []).map((t, i) => (
                <ToolPill key={`${t.name}-${i}`} {...t} />
              ))}
            </div>
            {draft ? (
              <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 whitespace-pre-wrap">
                {draft}
              </div>
            ) : busy ? (
              <div className="text-sm text-zinc-500">{t.thinking}</div>
            ) : null}
          </div>
        )}

        {err && (
          <div className="rounded-lg border border-rose-800 bg-rose-950/40 text-rose-100 text-sm p-3">
            {err}
          </div>
        )}

        {undo && Date.now() < undo.until && (
          <button
            type="button"
            onClick={() => void undoLast()}
            className="text-xs text-amber-200 underline"
          >
            {t.undoSave}
          </button>
        )}
      </div>

      <div
        className="shrink-0 z-20"
        style={{
          paddingBottom: tabBarVisible && kb < 80 ? 0 : kb > 40 ? kb : 0,
        }}
      >
        <Composer
          disabled={busy || !kek}
          keyboardInset={kb}
          tabBarVisible={tabBarVisible}
          settings={settings}
          onSend={(t) => void onSend(t)}
        />
      </div>
    </div>
  );
}

function ContextAuditLine({ audit }: { audit: ThreadMessage["context_audit"] }) {
  const { t } = useLocale();
  if (!audit) return null;
  const searched = audit.tools.some((x) => x.name === "search_entries" || x.entry_ids.length > 0);
  if (!searched && audit.unique_decrypted === 0) return null;
  const n = new Set(audit.tools.flatMap((x) => x.entry_ids)).size;
  return (
    <p className="text-[11px] text-zinc-500">
      {t.contextUsed.replace("{n}", String(n))}
      {audit.sent_plaintext_to_model ? ` · ${t.contextPlaintextCloud}` : ` · ${t.contextOpenOnly}`}
    </p>
  );
}
