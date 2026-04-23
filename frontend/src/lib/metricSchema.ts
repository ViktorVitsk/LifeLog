/**
 * Skill.metric_schema convention (JSONB, client-owned shape).
 * Used to render dynamic inputs in SKILL_SESSION → `custom_metrics` in ciphertext.
 */

export type MetricFieldType = "number" | "slider" | "text" | "select";

export interface MetricFieldBase {
  key: string;
  label: string;
  type: MetricFieldType;
}

export interface MetricFieldNumber extends MetricFieldBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
}

export interface MetricFieldSlider extends MetricFieldBase {
  type: "slider";
  min: number;
  max: number;
}

export interface MetricFieldText extends MetricFieldBase {
  type: "text";
  multiline?: boolean;
}

export interface MetricFieldSelect extends MetricFieldBase {
  type: "select";
  options: { value: string; label?: string }[];
}

export type MetricField =
  | MetricFieldNumber
  | MetricFieldSlider
  | MetricFieldText
  | MetricFieldSelect;

export interface MetricSchema {
  v?: number;
  fields: MetricField[];
}

export const EMPTY_METRIC_SCHEMA: MetricSchema = { v: 1, fields: [] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isMetricField(x: unknown): x is MetricField {
  if (!isRecord(x)) return false;
  const key = x.key;
  const label = x.label;
  const type = x.type;
  if (typeof key !== "string" || !key.trim()) return false;
  if (typeof label !== "string") return false;
  if (type === "number" || type === "slider" || type === "text") return true;
  if (type === "select") {
    const opts = x.options;
    if (!Array.isArray(opts) || opts.length === 0) return false;
    return opts.every(
      (o) =>
        isRecord(o) &&
        typeof o.value === "string" &&
        (o.label === undefined || typeof o.label === "string"),
    );
  }
  return false;
}

/** Normalise arbitrary JSONB from the server into a safe MetricSchema. */
export function parseMetricSchema(raw: unknown): MetricSchema {
  if (!isRecord(raw)) return { ...EMPTY_METRIC_SCHEMA };
  const fields = Array.isArray(raw.fields) ? raw.fields.filter(isMetricField) : [];
  const v = typeof raw.v === "number" ? raw.v : 1;
  return { v, fields };
}

export function emptyCustomMetrics(schema: MetricSchema): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of schema.fields) {
    if (f.type === "number" || f.type === "slider") out[f.key] = f.min ?? 0;
    else if (f.type === "text") out[f.key] = "";
    else if (f.type === "select" && f.options[0]) out[f.key] = f.options[0].value;
  }
  return out;
}
