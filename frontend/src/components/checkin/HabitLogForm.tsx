import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { api } from "../../lib/api";
import { encryptAndEnqueue } from "../../lib/entrySubmit";
import { ChoiceGrid, Segmented } from "../ui/ChoiceGrid";

export default function HabitLogForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek, token } = useAuth();
  const { t } = useLocale();
  const habitsQuery = useQuery({
    queryKey: ["habits", token],
    enabled: Boolean(token),
    queryFn: () => api.listHabits(token!),
  });

  const habits = useMemo(
    () => (habitsQuery.data ?? []).filter((h) => h.is_active),
    [habitsQuery.data],
  );

  const [habitId, setHabitId] = useState<string>("");
  useEffect(() => {
    if (!habitId && habits.length > 0) setHabitId(habits[0].id);
  }, [habitId, habits]);

  const habit = habits.find((h) => h.id === habitId);

  const [completed, setCompleted] = useState(true);
  const [value, setValue] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!kek || !habitId) return;
    setBusy(true);
    setErr(null);
    try {
      const habitValue =
        value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
      await encryptAndEnqueue({
        kek,
        entry_type: "HABIT_LOG",
        plaintext: {
          notes: notes.trim() || undefined,
        },
        openFields: {
          habit_id: habitId,
          habit_completed: completed,
          habit_value: habitValue,
          tags: ["habit_log"],
        },
      });
      setNotes("");
      setValue("");
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (habitsQuery.isLoading) {
    return <div className="text-sm text-zinc-500">{t.loadingHabits}</div>;
  }
  if (habits.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center space-y-3">
        <p className="text-sm text-zinc-400">{t.noActiveHabits}</p>
        <Link
          to="/insights/habits"
          className="inline-flex min-h-[44px] items-center px-4 rounded-xl bg-indigo-600 text-sm text-white"
        >
          {t.goToHabits}
        </Link>
      </div>
    );
  }

  const showValue =
    habit && (habit.target_value != null || (habit.unit && habit.unit.trim().length > 0));

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm text-zinc-300 mb-2">{t.pickHabit}</div>
        <ChoiceGrid
          items={habits.map((h) => ({
            id: h.id,
            name: h.name,
            color: h.color,
            hint: h.frequency === "weekly" ? t.freqWeekly : t.freqDaily,
          }))}
          value={habitId}
          onChange={setHabitId}
        />
      </div>

      <Segmented
        value={completed ? "done" : "miss"}
        onChange={(id) => setCompleted(id === "done")}
        options={[
          { id: "done", label: t.habitDone, activeClass: "border-emerald-500 bg-emerald-700 text-white" },
          { id: "miss", label: t.missedToday, activeClass: "border-zinc-500 bg-zinc-700 text-white" },
        ]}
      />

      {showValue ? (
        <label className="block">
          <span className="text-sm text-zinc-300">
            {t.value}
            {habit?.unit ? ` · ${habit.unit}` : ""}
          </span>
          <input
            type="number"
            className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2.5 text-sm min-h-[44px]"
            placeholder={
              habit?.target_value != null
                ? t.targetApprox.replace("{n}", String(habit.target_value))
                : ""
            }
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              setValue(v === "" ? "" : Number(v));
            }}
          />
        </label>
      ) : null}

      <div>
        <label className="text-sm text-zinc-300">{t.notesEncrypted}</label>
        <textarea
          className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 h-20"
          placeholder={t.optionalContext}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {err && (
        <div className="rounded-xl border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !habitId}
        className="w-full min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
      >
        {busy ? "…" : t.logHabit}
      </button>
    </div>
  );
}
