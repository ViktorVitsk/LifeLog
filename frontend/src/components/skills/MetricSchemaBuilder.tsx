import { useState } from "react";
import type { MetricField, MetricFieldType, MetricSchema } from "../../lib/metricSchema";

interface Props {
  schema: MetricSchema;
  onChange: (next: MetricSchema) => void;
}

const TYPES: MetricFieldType[] = ["slider", "number", "text", "select"];

/** Simple UI to edit `metric_schema.fields` when creating or updating a skill. */
export default function MetricSchemaBuilder({ schema, onChange }: Props) {
  const fields = schema.fields;

  function updateField(i: number, patch: Partial<MetricField>) {
    const next = fields.map((f, j) => (j === i ? ({ ...f, ...patch } as MetricField) : f));
    onChange({ ...schema, fields: next });
  }

  function replaceField(i: number, nextField: MetricField) {
    onChange({ ...schema, fields: fields.map((x, j) => (j === i ? nextField : x)) });
  }

  function removeField(i: number) {
    onChange({ ...schema, fields: fields.filter((_, j) => j !== i) });
  }

  function addField() {
    const key = `metric_${fields.length + 1}`;
    const f: MetricField = {
      key,
      label: "New metric",
      type: "slider",
      min: 1,
      max: 10,
    };
    onChange({ ...schema, fields: [...fields, f] });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-wide">Metric schema</span>
        <button
          type="button"
          onClick={addField}
          className="text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800"
        >
          + Add field
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-zinc-500">No custom metrics — session form will only ask for notes.</p>
      ) : (
        <ul className="space-y-2">
          {fields.map((f, i) => (
            <li key={i} className="rounded border border-zinc-800 p-2 space-y-2">
              <div className="flex flex-wrap gap-2 items-end">
                <label className="text-xs">
                  <span className="text-zinc-500">key</span>
                  <input
                    className="block mt-0.5 w-28 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 font-mono text-xs"
                    value={f.key}
                    onChange={(e) => updateField(i, { key: e.target.value.replace(/\s+/g, "_") })}
                  />
                </label>
                <label className="text-xs flex-1 min-w-[120px]">
                  <span className="text-zinc-500">label</span>
                  <input
                    className="block mt-0.5 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                  />
                </label>
                <label className="text-xs">
                  <span className="text-zinc-500">type</span>
                  <select
                    className="block mt-0.5 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs"
                    value={f.type}
                    onChange={(e) => {
                      const t = e.target.value as MetricFieldType;
                      const base = { key: f.key, label: f.label };
                      if (t === "slider")
                        replaceField(i, { ...base, type: "slider", min: 1, max: 10 });
                      else if (t === "number")
                        replaceField(i, { ...base, type: "number", min: 0, max: 9999 });
                      else if (t === "text")
                        replaceField(i, { ...base, type: "text", multiline: false });
                      else
                        replaceField(i, {
                          ...base,
                          type: "select",
                          options: [{ value: "a", label: "Option A" }],
                        });
                    }}
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => removeField(i)}
                  className="text-xs text-rose-400 hover:underline mb-0.5"
                >
                  remove
                </button>
              </div>
              {f.type === "slider" || f.type === "number" ? (
                <div className="flex gap-2 text-xs">
                  <label>
                    min
                    <input
                      type="number"
                      className="block w-16 mt-0.5 rounded bg-zinc-900 border border-zinc-700 px-1"
                      value={f.min ?? 0}
                      onChange={(e) => updateField(i, { min: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    max
                    <input
                      type="number"
                      className="block w-16 mt-0.5 rounded bg-zinc-900 border border-zinc-700 px-1"
                      value={f.max ?? 10}
                      onChange={(e) => updateField(i, { max: Number(e.target.value) })}
                    />
                  </label>
                </div>
              ) : null}
              {f.type === "text" ? (
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={Boolean(f.multiline)}
                    onChange={(e) => updateField(i, { multiline: e.target.checked })}
                  />
                  multiline
                </label>
              ) : null}
              {f.type === "select" ? <SelectOptionsEditor field={f} onChange={(opts) => updateField(i, { options: opts })} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectOptionsEditor({
  field,
  onChange,
}: {
  field: Extract<MetricField, { type: "select" }>;
  onChange: (opts: { value: string; label?: string }[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="text-xs space-y-1">
      <div className="text-zinc-500">options (value|label per line)</div>
      <textarea
        className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 font-mono h-16"
        value={field.options.map((o) => (o.label ? `${o.value}|${o.label}` : o.value)).join("\n")}
        onChange={(e) => {
          const lines = e.target.value.split("\n").filter(Boolean);
          const opts =
            lines.length === 0
              ? [{ value: "option", label: "Option" }]
              : lines.map((line) => {
                  const [v, ...rest] = line.split("|");
                  const value = v.trim() || "option";
                  const label = rest.join("|").trim() || undefined;
                  return { value, label };
                });
          onChange(opts);
        }}
      />
      <div className="flex gap-1">
        <input
          className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
          placeholder="quick add value"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="px-2 py-1 rounded border border-zinc-700"
          onClick={() => {
            if (!draft.trim()) return;
            onChange([...field.options, { value: draft.trim() }]);
            setDraft("");
          }}
        >
          add
        </button>
      </div>
    </div>
  );
}
