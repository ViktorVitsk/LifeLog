import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { useSkills } from "../../hooks/useCatalog";
import { encryptAndEnqueue } from "../../lib/entrySubmit";
import {
  emptyCustomMetrics,
  parseMetricSchema,
  type MetricSchema,
} from "../../lib/metricSchema";
import MetricFieldsForm from "../skills/MetricFieldsForm";
import { ChoiceGrid } from "../ui/ChoiceGrid";
import Slider from "../ui/Slider";

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

export default function SkillSessionForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek } = useAuth();
  const { t } = useLocale();
  const skillsQuery = useSkills();

  const skills = useMemo(
    () => (skillsQuery.data ?? []).filter((s) => s.is_active),
    [skillsQuery.data],
  );

  const [skillId, setSkillId] = useState<string>("");
  useEffect(() => {
    if (!skillId && skills.length > 0) setSkillId(skills[0].id);
  }, [skillId, skills]);

  const schema: MetricSchema = useMemo(() => {
    const s = skills.find((x) => x.id === skillId);
    return s ? parseMetricSchema(s.metric_schema) : parseMetricSchema(null);
  }, [skills, skillId]);

  const [customMetrics, setCustomMetrics] = useState<Record<string, string | number>>({});
  useEffect(() => {
    setCustomMetrics(emptyCustomMetrics(schema));
  }, [schema]);

  const [duration, setDuration] = useState(45);
  const [whatWorked, setWhatWorked] = useState("");
  const [whatToImprove, setWhatToImprove] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!kek || !skillId) return;
    setBusy(true);
    setErr(null);
    try {
      await encryptAndEnqueue({
        kek,
        entry_type: "SKILL_SESSION",
        plaintext: {
          custom_metrics: customMetrics,
          what_worked: whatWorked,
          what_to_improve: whatToImprove,
        },
        openFields: {
          skill_id: skillId,
          session_duration_min: duration,
          tags: ["skill_session"],
        },
      });
      setWhatWorked("");
      setWhatToImprove("");
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (skillsQuery.isLoading) {
    return <div className="text-sm text-zinc-500">{t.loadingSkills}</div>;
  }
  if (skills.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center space-y-3">
        <p className="text-sm text-zinc-400">{t.noActiveSkills}</p>
        <Link
          to="/insights/skills"
          className="inline-flex min-h-[44px] items-center px-4 rounded-xl bg-indigo-600 text-sm text-white"
        >
          {t.goToSkills}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm text-zinc-300 mb-2">{t.pickSkill}</div>
        <ChoiceGrid
          items={skills.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
          value={skillId}
          onChange={setSkillId}
        />
      </div>

      <div>
        <Slider
          label={t.sessionDuration}
          value={duration}
          min={5}
          max={240}
          unit={t.minShort}
          showMax={false}
          onChange={setDuration}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDuration(m)}
              className={`min-h-[36px] px-2.5 rounded-full border text-xs ${
                duration === m
                  ? "border-indigo-500 bg-indigo-950/70 text-indigo-100"
                  : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {m} {t.minShort}
            </button>
          ))}
        </div>
      </div>

      <MetricFieldsForm schema={schema} value={customMetrics} onChange={setCustomMetrics} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm text-zinc-300">{t.whatWorked}</label>
          <textarea
            className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 h-24"
            value={whatWorked}
            onChange={(e) => setWhatWorked(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">{t.toImprove}</label>
          <textarea
            className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-3 py-2 h-24"
            value={whatToImprove}
            onChange={(e) => setWhatToImprove(e.target.value)}
          />
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !skillId}
        className="w-full min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
      >
        {busy ? "…" : t.saveSession}
      </button>
    </div>
  );
}
