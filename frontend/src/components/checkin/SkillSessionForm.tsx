import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { api } from "../../lib/api";
import { encryptAndEnqueue } from "../../lib/entrySubmit";
import {
  emptyCustomMetrics,
  parseMetricSchema,
  type MetricSchema,
} from "../../lib/metricSchema";
import MetricFieldsForm from "../skills/MetricFieldsForm";
import Slider from "../ui/Slider";

export default function SkillSessionForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek, token } = useAuth();
  const { t } = useLocale();
  const skillsQuery = useQuery({
    queryKey: ["skills", token],
    enabled: Boolean(token),
    queryFn: () => api.listSkills(token!),
  });

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
      <div className="text-sm text-zinc-400 space-y-2">
        <p>{t.noActiveSkills}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm text-zinc-300">{t.skill}</span>
        <select
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
          value={skillId}
          onChange={(e) => setSkillId(e.target.value)}
        >
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <Slider label={t.sessionDuration} value={duration} min={5} max={240} onChange={setDuration} />

      <MetricFieldsForm schema={schema} value={customMetrics} onChange={setCustomMetrics} />

      <div>
        <label className="text-sm text-zinc-300">{t.whatWorked}</label>
        <textarea
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-20"
          value={whatWorked}
          onChange={(e) => setWhatWorked(e.target.value)}
        />
      </div>
      <div>
        <label className="text-sm text-zinc-300">{t.toImprove}</label>
        <textarea
          className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-20"
          value={whatToImprove}
          onChange={(e) => setWhatToImprove(e.target.value)}
        />
      </div>

      {err && (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !skillId}
        className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
      >
        {busy ? "…" : t.saveSession}
      </button>
    </div>
  );
}
