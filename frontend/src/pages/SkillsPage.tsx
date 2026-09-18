import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import SkillSessionChart from "../components/skills/SkillSessionChart";
import SkillSessionHistory from "../components/skills/SkillSessionHistory";
import MetricSchemaBuilder from "../components/skills/MetricSchemaBuilder";
import { ColorDots } from "../components/ui/ChoiceGrid";
import { useEntries } from "../hooks/useEntries";
import { api, isNetworkError, type Skill } from "../lib/api";
import { EMPTY_METRIC_SCHEMA, parseMetricSchema, type MetricSchema } from "../lib/metricSchema";

export default function SkillsPage() {
  const { token } = useAuth();
  const { t } = useLocale();
  const qc = useQueryClient();
  const { entries } = useEntries();

  const skillsQuery = useQuery({
    queryKey: ["skills", token],
    enabled: Boolean(token),
    queryFn: () => api.listSkills(token!),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const skills = skillsQuery.data ?? [];
  const activeSkills = useMemo(() => skills.filter((s) => s.is_active), [skills]);

  const selected = skills.find((s) => s.id === selectedId) ?? activeSkills[0] ?? null;
  const showCreate = !skillsQuery.isLoading && (creating || skills.length === 0);

  const sessionEntries = useMemo(() => {
    if (!selected) return [];
    return entries.filter(
      (e) =>
        e.entry_type === "SKILL_SESSION" &&
        e.skill_id != null &&
        String(e.skill_id) === String(selected.id),
    );
  }, [entries, selected]);

  const rawErr = skillsQuery.error as Error | null;
  const offline: boolean = rawErr ? isNetworkError(rawErr) : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.skillsTitle}</h1>
        <p className="text-sm text-zinc-400 mt-1">{t.skillsHint}</p>
      </div>

      {offline ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-xs p-2">
          {t.offlineSkills}
        </div>
      ) : rawErr ? (
        <div className="rounded-xl border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {rawErr.message}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {skillsQuery.isLoading && <p className="text-sm text-zinc-500">{t.loading}</p>}
          {skills.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-medium text-zinc-200">{t.yourSkills}</h2>
              <button
                type="button"
                onClick={() => setCreating((v) => !v)}
                className="text-xs min-h-[36px] px-3 rounded-full border border-zinc-700 hover:bg-zinc-800"
              >
                {creating ? t.hide : t.newSkill}
              </button>
            </div>
            <ul className="space-y-1.5">
                {skills.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className={`w-full text-left px-3 min-h-[44px] rounded-xl text-sm flex items-center gap-2 ${
                        selected?.id === s.id
                          ? "bg-indigo-900/40 border border-indigo-700"
                          : "border border-zinc-800 hover:bg-zinc-800"
                      } ${s.is_active ? "" : "opacity-50"}`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: s.color || "#6366f1" }}
                      />
                      <span className="flex-1 truncate">{s.name}</span>
                      {!s.is_active && (
                        <span className="text-[10px] text-zinc-500 uppercase">{t.off}</span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          )}

          {showCreate && (
            <CreateSkillForm
              token={token ?? ""}
              disabled={!token || offline}
              onCreated={(s) => {
                qc.invalidateQueries({ queryKey: ["skills"] });
                setSelectedId(s.id);
                setCreating(false);
              }}
            />
          )}
        </div>

        <div className="space-y-4">
          {selected ? (
            <>
              <SkillSessionChart entries={sessionEntries} days={56} />
              <SkillSessionHistory entries={entries} skillId={selected.id} />
              <SkillEditor
                skill={selected}
                token={token ?? ""}
                disabled={!token || offline}
                onSaved={() => qc.invalidateQueries({ queryKey: ["skills"] })}
              />
            </>
          ) : (
            <p className="text-sm text-zinc-500">{t.createSkillToSee}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateSkillForm({
  token,
  disabled,
  onCreated,
}: {
  token: string;
  disabled: boolean;
  onCreated: (s: Skill) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [schema, setSchema] = useState<MetricSchema>(EMPTY_METRIC_SCHEMA);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await api.createSkill(token, {
        name: name.trim(),
        color,
        metric_schema: schema as unknown as Record<string, unknown>,
      });
      setName("");
      setSchema(EMPTY_METRIC_SCHEMA);
      setMetricsOpen(false);
      onCreated(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
      <h2 className="text-sm font-medium text-zinc-200">{t.newSkill}</h2>
      <input
        className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2.5 text-sm min-h-[44px]"
        placeholder={t.skillNamePlaceholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div>
        <div className="text-xs text-zinc-400 mb-1.5">{t.color}</div>
        <ColorDots value={color} onChange={setColor} />
      </div>
      {metricsOpen || schema.fields.length > 0 ? (
        <MetricSchemaBuilder schema={schema} onChange={setSchema} />
      ) : (
        <button
          type="button"
          onClick={() => setMetricsOpen(true)}
          className="text-xs text-zinc-400 underline underline-offset-2"
        >
          {t.addMetricsOptional}
        </button>
      )}
      {err && (
        <div className="text-xs text-rose-300 border border-rose-800 rounded-xl p-2">{err}</div>
      )}
      <button
        type="button"
        disabled={disabled || busy || !name.trim()}
        onClick={submit}
        className="w-full min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm"
      >
        {busy ? "…" : t.createSkill}
      </button>
    </div>
  );
}

function SkillEditor({
  skill,
  token,
  disabled,
  onSaved,
}: {
  skill: Skill;
  token: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [schema, setSchema] = useState<MetricSchema>(() => parseMetricSchema(skill.metric_schema));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSchema(parseMetricSchema(skill.metric_schema));
  }, [skill.id, skill.metric_schema]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.updateSkill(token, skill.id, {
        metric_schema: schema as unknown as Record<string, unknown>,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    setErr(null);
    try {
      await api.updateSkill(token, skill.id, { is_active: !skill.is_active });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">
          {t.editSkill.replace("{name}", skill.name)}
        </h2>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={toggleActive}
          className="text-xs min-h-[36px] px-3 rounded-full border border-zinc-700 hover:bg-zinc-800"
        >
          {skill.is_active ? t.deactivate : t.activate}
        </button>
      </div>
      <MetricSchemaBuilder schema={schema} onChange={setSchema} />
      {err && (
        <div className="text-xs text-rose-300 border border-rose-800 rounded-xl p-2">{err}</div>
      )}
      <button
        type="button"
        disabled={disabled || busy}
        onClick={save}
        className="w-full min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-sm"
      >
        {busy ? "…" : t.saveSchema}
      </button>
    </div>
  );
}
