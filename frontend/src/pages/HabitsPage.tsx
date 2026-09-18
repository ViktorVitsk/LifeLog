import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import HabitHeatmap from "../components/habits/HabitHeatmap";
import HabitLogHistory from "../components/habits/HabitLogHistory";
import { useEntries } from "../hooks/useEntries";
import { api, isNetworkError, type Habit, type HabitFrequency } from "../lib/api";

export default function HabitsPage() {
  const { token } = useAuth();
  const { t } = useLocale();
  const qc = useQueryClient();
  const { entries } = useEntries();

  const habitsQuery = useQuery({
    queryKey: ["habits", token],
    enabled: Boolean(token),
    queryFn: () => api.listHabits(token!),
  });

  const habits = habitsQuery.data ?? [];
  const active = useMemo(() => habits.filter((h) => h.is_active), [habits]);
  const [selectedId, setSelectedId] = useState<string>("");

  const selected = habits.find((h) => h.id === selectedId) ?? active[0];
  const habitIdForHeatmap = selected?.id ?? "";

  const rawErr = habitsQuery.error as Error | null;
  const offline: boolean = rawErr ? isNetworkError(rawErr) : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.habitsTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.habitsHint}</p>
      </div>

      {offline ? (
        <div className="rounded border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-xs p-2">
          {t.offlineHabits}
        </div>
      ) : rawErr ? (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {rawErr.message}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <CreateHabitForm
            token={token ?? ""}
            disabled={!token || offline}
            onCreated={(h) => {
              qc.invalidateQueries({ queryKey: ["habits"] });
              setSelectedId(h.id);
            }}
          />
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="text-sm font-medium text-zinc-200 mb-2">{t.yourHabits}</h2>
            {habitsQuery.isLoading ? (
              <p className="text-sm text-zinc-500">{t.loading}</p>
            ) : habits.length === 0 ? (
              <p className="text-sm text-zinc-500">{t.noHabits}</p>
            ) : (
              <ul className="space-y-1">
                {habits.map((h) => (
                  <li key={h.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(h.id)}
                      className={`flex-1 text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                        String(habitIdForHeatmap) === String(h.id)
                          ? "bg-indigo-900/40 border border-indigo-700"
                          : "border border-transparent hover:bg-zinc-800"
                      } ${h.is_active ? "" : "opacity-50"}`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: h.color || "#10b981" }}
                      />
                      <span className="flex-1 truncate">{h.name}</span>
                      <span className="text-[10px] text-zinc-500">
                        {h.frequency === "weekly" ? t.freqWeekly : t.freqDaily}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={!token || offline}
                      onClick={async () => {
                        try {
                          await api.updateHabit(token!, h.id, { is_active: !h.is_active });
                          qc.invalidateQueries({ queryKey: ["habits"] });
                        } catch {
                          /* toast optional */
                        }
                      }}
                      className="text-[10px] px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 shrink-0"
                    >
                      {h.is_active ? t.off : t.on}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {habitIdForHeatmap ? (
            <>
              <HabitHeatmap entries={entries} habitId={habitIdForHeatmap} weeks={14} />
              <HabitLogHistory entries={entries} habitId={habitIdForHeatmap} />
            </>
          ) : (
            <p className="text-sm text-zinc-500">{t.createHabitToSee}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateHabitForm({
  token,
  disabled,
  onCreated,
}: {
  token: string;
  disabled: boolean;
  onCreated: (h: Habit) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<HabitFrequency>("daily");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [color, setColor] = useState("#10b981");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const tv = target.trim() === "" ? null : Number(target);
      const h = await api.createHabit(token, {
        name: name.trim(),
        frequency,
        target_value: tv !== null && Number.isFinite(tv) ? tv : null,
        unit: unit.trim() || null,
        color,
      });
      setName("");
      setTarget("");
      setUnit("");
      onCreated(h);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <h2 className="text-sm font-medium text-zinc-200">{t.newHabit}</h2>
      <input
        className="w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm"
        placeholder={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="block text-xs text-zinc-400">
        {t.frequency}
        <select
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as HabitFrequency)}
        >
          <option value="daily">{t.freqDaily}</option>
          <option value="weekly">{t.freqWeekly}</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-zinc-400">
          {t.targetOptional}
          <input
            type="number"
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <label className="text-xs text-zinc-400">
          {t.unit}
          <input
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm"
            placeholder={t.unitPlaceholder}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        {t.color}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      {err && <div className="text-xs text-rose-300">{err}</div>}
      <button
        type="button"
        disabled={disabled || busy || !name.trim()}
        onClick={submit}
        className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm"
      >
        {busy ? "…" : t.createHabit}
      </button>
    </div>
  );
}
