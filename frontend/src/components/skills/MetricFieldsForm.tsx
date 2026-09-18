import { useLocale } from "../../context/LocaleContext";
import type { MetricField, MetricSchema } from "../../lib/metricSchema";
import Slider from "../ui/Slider";

interface Props {
  schema: MetricSchema;
  value: Record<string, string | number>;
  onChange: (next: Record<string, string | number>) => void;
}

/** Renders inputs for SKILL_SESSION.custom_metrics from a skill's metric_schema. */
export default function MetricFieldsForm({ schema, value, onChange }: Props) {
  const { t } = useLocale();
  if (schema.fields.length === 0) return null;

  function patch(key: string, v: string | number) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="space-y-3 rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-xs text-zinc-500 uppercase tracking-wide">{t.customMetricsEnc}</div>
      {schema.fields.map((f) => (
        <FieldRow key={f.key} field={f} value={value[f.key]} onChange={(v) => patch(f.key, v)} />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: MetricField;
  value: string | number | undefined;
  onChange: (v: string | number) => void;
}) {
  switch (field.type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value) || 0;
      return (
        <label className="block">
          <span className="text-sm text-zinc-300">{field.label}</span>
          <input
            type="number"
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={Number.isFinite(n) ? n : 0}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </label>
      );
    }
    case "slider": {
      const min = field.min;
      const max = field.max;
      const n = typeof value === "number" ? value : min;
      return (
        <Slider label={field.label} min={min} max={max} value={n} onChange={onChange} />
      );
    }
    case "text": {
      const s = typeof value === "string" ? value : String(value ?? "");
      if (field.multiline) {
        return (
          <label className="block">
            <span className="text-sm text-zinc-300">{field.label}</span>
            <textarea
              className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-20 text-sm"
              value={s}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        );
      }
      return (
        <label className="block">
          <span className="text-sm text-zinc-300">{field.label}</span>
          <input
            type="text"
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
            value={s}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    }
    case "select": {
      const s = typeof value === "string" ? value : field.options[0]?.value ?? "";
      return (
        <label className="block">
          <span className="text-sm text-zinc-300">{field.label}</span>
          <select
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2"
            value={s}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label ?? o.value}
              </option>
            ))}
          </select>
        </label>
      );
    }
    default:
      return null;
  }
}
