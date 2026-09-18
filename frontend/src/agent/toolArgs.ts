export interface ToolArgError {
  error: "invalid_tool_args";
  details: string[];
}

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
};

function typeNames(schema: JsonSchema): string[] {
  if (!schema.type) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "string") return typeof value === "string";
  if (type === "number" || type === "integer") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  return true;
}

export function parseJsonObject(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: ToolArgError } {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      return { ok: false, error: { error: "invalid_tool_args", details: ["arguments must be a JSON object"] } };
    }
    return { ok: true, value: v as Record<string, unknown> };
  } catch {
    return { ok: false, error: { error: "invalid_tool_args", details: ["arguments are not valid JSON"] } };
  }
}

export function validateAgainstJsonSchema(
  schema: JsonSchema,
  value: unknown,
  path = "$",
): string[] {
  const errors: string[] = [];
  const types = typeNames(schema);
  if (types.length && !types.some((t) => matchesType(value, t))) {
    errors.push(`${path}: expected ${types.join("|")}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: not in enum`);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (types.includes("object") && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: missing ${key}`);
    }
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(props)) {
      if (key in obj && obj[key] !== undefined) {
        errors.push(...validateAgainstJsonSchema(child, obj[key], `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push(`${path}: unexpected ${key}`);
      }
    }
  }
  if (types.includes("array") && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validateAgainstJsonSchema(schema.items as JsonSchema, item, `${path}[${i}]`));
    });
  }
  return errors;
}

const TOOL_SCHEMAS: Record<string, JsonSchema> = {
  get_today_snapshot: { type: "object", additionalProperties: true },
  list_skills: { type: "object", additionalProperties: true },
  list_habits: { type: "object", additionalProperties: true },
  propose_entries: {
    type: "object",
    required: ["entries"],
    additionalProperties: false,
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          required: ["entry_type"],
          properties: {
            entry_type: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            provenance: { type: "string", enum: ["user_stated", "agent_extracted", "agent_inferred"] },
          },
        },
      },
    },
  },
  search_entries: {
    type: "object",
    additionalProperties: false,
    properties: {
      entry_type: { type: "string" },
      tag: { type: "string" },
      start_date: { type: "string" },
      end_date: { type: "string" },
      decrypt: { type: "boolean" },
      limit: { type: "number", minimum: 1, maximum: 100 },
    },
  },
  show_chart: {
    type: "object",
    required: ["kind"],
    additionalProperties: true,
    properties: {
      kind: { type: "string", enum: ["trend", "scatter", "habit_heatmap", "skill_bars"] },
      metric: { type: "string" },
      period: { type: "string", enum: ["7d", "30d", "90d", "1y"] },
    },
  },
  pin_chart: {
    type: "object",
    required: ["kind"],
    additionalProperties: true,
    properties: {
      kind: { type: "string", enum: ["trend", "scatter", "habit_heatmap", "skill_bars"] },
    },
  },
  commit_entries: {
    type: "object",
    required: ["ids"],
    additionalProperties: false,
    properties: { ids: { type: "array", items: { type: "string" } } },
  },
  create_skill: {
    type: "object",
    required: ["name"],
    additionalProperties: true,
    properties: { name: { type: "string" } },
  },
  create_habit: {
    type: "object",
    required: ["name"],
    additionalProperties: true,
    properties: { name: { type: "string" } },
  },
  update_habit: {
    type: "object",
    required: ["id"],
    additionalProperties: true,
    properties: { id: { type: "string" } },
  },
};

export function validateToolArgs(
  name: string,
  args: Record<string, unknown>,
): { ok: true } | { ok: false; error: ToolArgError } {
  const schema = TOOL_SCHEMAS[name];
  if (!schema) return { ok: true };
  const details = validateAgainstJsonSchema(schema, args);
  if (details.length) return { ok: false, error: { error: "invalid_tool_args", details } };
  return { ok: true };
}
