import { useState } from "react";
import { summaryLine } from "../../agent/commit";
import type { ProposedEntry } from "../../agent/types";
import { useLocale } from "../../context/LocaleContext";
import { entryTypeLabel } from "../../i18n/strings";
import type { Habit, Skill } from "../../lib/api";

interface Props {
  entry: ProposedEntry;
  habits: Habit[];
  skills: Skill[];
  busy?: boolean;
  onChange: (next: ProposedEntry) => void;
  onSave: () => void;
  onDismiss: () => void;
}

export default function EntryCard({
  entry,
  habits,
  skills,
  busy,
  onChange,
  onSave,
  onDismiss,
}: Props) {
  const { locale, t } = useLocale();
  const unmatched =
    (entry.entry_type === "HABIT_LOG" && !entry.habit_id) ||
    (entry.entry_type === "SKILL_SESSION" && !entry.skill_id);
  const [open, setOpen] = useState(entry.provenance === "agent_inferred" || unmatched);
  const inferred = entry.provenance === "agent_inferred";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-zinc-100">{entryTypeLabel(t, entry.entry_type)}</div>
          <div className="text-xs text-zinc-400">{summaryLine(entry, locale) || t.reviewFields}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {entry.provenance}
            {inferred ? ` · ${t.confirmNumbers}` : ""} · {Math.round(entry.confidence * 100)}%
          </div>
        </div>
        <button
          type="button"
          className="text-xs text-zinc-400 min-h-[44px] px-2"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t.hide : t.edit}
        </button>
      </div>

      {(open || unmatched) && (
        <FieldEditor entry={entry} habits={habits} skills={skills} onChange={onChange} />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="flex-1 min-h-[44px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm disabled:opacity-40"
        >
          {t.save}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="min-h-[44px] px-4 rounded-lg border border-zinc-700 text-sm text-zinc-300"
        >
          {t.dismiss}
        </button>
      </div>
    </div>
  );
}

function FieldEditor({
  entry,
  habits,
  skills,
  onChange,
}: {
  entry: ProposedEntry;
  habits: Habit[];
  skills: Skill[];
  onChange: (next: ProposedEntry) => void;
}) {
  const { t } = useLocale();
  const set = (patch: Partial<ProposedEntry>) => onChange({ ...entry, ...patch });
  const activeHabits = habits.filter((h) => h.is_active);
  const activeSkills = skills.filter((s) => s.is_active);

  return (
    <div className="grid gap-2">
      {entry.entry_type === "HABIT_LOG" && (
        <LinkBlock
          missingLabel={t.habitMissing.replace("{name}", entry.habit_name?.trim() || "—")}
          hint={t.saveCreatesHabit}
          pickLabel={t.pickExisting}
          nameLabel={t.newName}
          unmatched={!entry.habit_id}
          options={activeHabits.map((h) => ({ id: h.id, name: h.name }))}
          selectedId={entry.habit_id}
          name={entry.habit_name ?? ""}
          onSelect={(id, name) => set({ habit_id: id || undefined, habit_name: name })}
          onName={(name) => set({ habit_name: name, habit_id: undefined })}
        />
      )}
      {entry.entry_type === "SKILL_SESSION" && (
        <LinkBlock
          missingLabel={t.skillMissing.replace("{name}", entry.skill_name?.trim() || "—")}
          hint={t.saveCreatesSkill}
          pickLabel={t.pickExisting}
          nameLabel={t.newName}
          unmatched={!entry.skill_id}
          options={activeSkills.map((s) => ({ id: s.id, name: s.name }))}
          selectedId={entry.skill_id}
          name={entry.skill_name ?? ""}
          onSelect={(id, name) => set({ skill_id: id || undefined, skill_name: name })}
          onName={(name) => set({ skill_name: name, skill_id: undefined })}
        />
      )}

      {(entry.entry_type === "DAILY_CHECKIN" || entry.entry_type === "THOUGHT") && (
        <>
          <NumField label={t.mood} value={entry.mood_score} onChange={(v) => set({ mood_score: v })} />
          {entry.entry_type === "DAILY_CHECKIN" && (
            <>
              <NumField
                label={t.energy}
                value={entry.energy_score}
                onChange={(v) => set({ energy_score: v })}
              />
              <NumField
                label={t.anxiety}
                value={entry.anxiety_score}
                onChange={(v) => set({ anxiety_score: v })}
              />
            </>
          )}
        </>
      )}
      {entry.entry_type === "SLEEP" && (
        <>
          <NumField
            label={t.hours}
            value={entry.sleep_hours}
            step={0.25}
            onChange={(v) => set({ sleep_hours: v })}
          />
          <NumField
            label={t.quality}
            value={entry.sleep_quality}
            onChange={(v) => set({ sleep_quality: v })}
          />
        </>
      )}
      {entry.entry_type === "HABIT_LOG" && (
        <label className="flex items-center gap-2 text-sm min-h-[44px]">
          <input
            type="checkbox"
            checked={entry.habit_completed !== false}
            onChange={(e) => set({ habit_completed: e.target.checked })}
          />
          {t.completed} ({entry.habit_name ?? t.typeHabit})
        </label>
      )}
      {entry.entry_type === "SKILL_SESSION" && (
        <NumField
          label={t.minutes}
          value={entry.session_duration_min}
          onChange={(v) => set({ session_duration_min: v })}
        />
      )}
      {entry.entry_type === "BODY_METRICS" && (
        <>
          <NumField label={t.weightKg} value={entry.weight_kg} step={0.1} onChange={(v) => set({ weight_kg: v })} />
          <NumField
            label={t.bodyFat}
            value={entry.body_fat_pct}
            step={0.1}
            onChange={(v) => set({ body_fat_pct: v })}
          />
        </>
      )}
      {entry.entry_type === "GRATITUDE" && (
        <textarea
          className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm min-h-[72px]"
          value={(entry.items ?? []).join("\n")}
          onChange={(e) =>
            set({ items: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
          }
        />
      )}
      <textarea
        className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm min-h-[64px]"
        placeholder={t.notes}
        value={entry.notes ?? entry.content ?? entry.reflection ?? ""}
        onChange={(e) =>
          set(
            entry.entry_type === "THOUGHT"
              ? { content: e.target.value }
              : { notes: e.target.value },
          )
        }
      />
    </div>
  );
}

function LinkBlock({
  missingLabel,
  hint,
  pickLabel,
  nameLabel,
  unmatched,
  options,
  selectedId,
  name,
  onSelect,
  onName,
}: {
  missingLabel: string;
  hint: string;
  pickLabel: string;
  nameLabel: string;
  unmatched: boolean;
  options: { id: string; name: string }[];
  selectedId?: string;
  name: string;
  onSelect: (id: string, name: string) => void;
  onName: (name: string) => void;
}) {
  return (
    <div
      className={`rounded-lg border p-2 space-y-2 ${
        unmatched ? "border-amber-900/70 bg-amber-950/30" : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      {unmatched && <p className="text-xs text-amber-100">{missingLabel}</p>}
      {options.length > 0 && (
        <label className="block text-xs text-zinc-400">
          {pickLabel}
          <select
            className="mt-0.5 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3 text-sm text-zinc-100"
            value={selectedId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              const hit = options.find((o) => o.id === id);
              onSelect(id, hit?.name ?? name);
            }}
          >
            <option value="">{unmatched ? "—" : name}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-xs text-zinc-400">
        {nameLabel}
        <input
          className="mt-0.5 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3 text-sm text-zinc-100"
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
      </label>
      {unmatched && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  return (
    <label className="text-xs text-zinc-400">
      {label}
      <input
        type="number"
        step={step}
        className="mt-0.5 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3 text-sm text-zinc-100"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </label>
  );
}
