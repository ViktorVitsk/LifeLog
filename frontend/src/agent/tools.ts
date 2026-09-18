import { api, type Habit, type Skill } from "../lib/api";
import { decryptEntry } from "../lib/crypto";
import type { MergedEntry } from "../hooks/useEntries";
import { commitProposedEntry, normalizeProposal } from "./commit";
import { pinChartSpec } from "./chatStore";
import { buildTodaySnapshot } from "./snapshot";
import type { ChartSpec, LlmSettings, ProposedEntry } from "./types";
import type { AppLocale } from "../i18n/locale";

export interface ToolRuntime {
  kek: CryptoKey;
  token: string;
  entries: MergedEntry[];
  skills: Skill[];
  habits: Habit[];
  settings: LlmSettings;
  locale: AppLocale;
  sourceTurnId: string;
  proposals: Map<string, ProposedEntry>;
  charts: ChartSpec[];
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asChartSpec(args: Record<string, unknown>): ChartSpec {
  const kind = args.kind;
  const k =
    kind === "scatter" || kind === "habit_heatmap" || kind === "skill_bars" ? kind : "trend";
  const period =
    args.period === "7d" || args.period === "90d" || args.period === "1y" || args.period === "30d"
      ? args.period
      : "30d";
  return {
    kind: k,
    metric: typeof args.metric === "string" ? args.metric : "mood_score",
    period,
    x: typeof args.x === "string" ? args.x : undefined,
    y: typeof args.y === "string" ? args.y : undefined,
    habit_id: typeof args.habit_id === "string" ? args.habit_id : undefined,
    skill_id: typeof args.skill_id === "string" ? args.skill_id : undefined,
    title: typeof args.title === "string" ? args.title : undefined,
  };
}

function resolveNamedId(
  list: { id: string; name: string }[],
  id?: unknown,
  name?: unknown,
): string | undefined {
  if (typeof id === "string" && list.some((x) => x.id === id)) return id;
  if (typeof name === "string") {
    const q = name.trim().toLowerCase();
    return list.find((x) => x.name.toLowerCase() === q || x.name.toLowerCase().includes(q))?.id;
  }
  return undefined;
}

export async function executeTool(
  name: string,
  rawArgs: string,
  rt: ToolRuntime,
): Promise<unknown> {
  const args = parseArgs(rawArgs);

  switch (name) {
    case "get_today_snapshot":
      return buildTodaySnapshot({
        entries: rt.entries,
        skills: rt.skills,
        habits: rt.habits,
        locale: rt.locale,
      });
    case "list_skills":
      return rt.skills.map((s) => ({
        id: s.id,
        name: s.name,
        is_active: s.is_active,
        metric_schema: s.metric_schema,
      }));
    case "list_habits":
      return rt.habits.map((h) => ({
        id: h.id,
        name: h.name,
        is_active: h.is_active,
        frequency: h.frequency,
        target_value: h.target_value,
        unit: h.unit,
      }));
    case "create_skill": {
      const created = await api.createSkill(rt.token, {
        name: String(args.name ?? "Untitled"),
        color: typeof args.color === "string" ? args.color : null,
        icon: typeof args.icon === "string" ? args.icon : null,
      });
      rt.skills.push(created);
      return { id: created.id, name: created.name };
    }
    case "create_habit": {
      const freq = args.frequency === "weekly" ? "weekly" : "daily";
      const created = await api.createHabit(rt.token, {
        name: String(args.name ?? "Untitled"),
        frequency: freq,
        target_value: typeof args.target_value === "number" ? args.target_value : null,
        unit: typeof args.unit === "string" ? args.unit : null,
        color: typeof args.color === "string" ? args.color : null,
      });
      rt.habits.push(created);
      return { id: created.id, name: created.name };
    }
    case "update_habit": {
      const id = String(args.id ?? "");
      const updated = await api.updateHabit(rt.token, id, {
        name: typeof args.name === "string" ? args.name : undefined,
        is_active: typeof args.is_active === "boolean" ? args.is_active : undefined,
        target_value: typeof args.target_value === "number" ? args.target_value : undefined,
        unit: typeof args.unit === "string" ? args.unit : undefined,
      });
      const idx = rt.habits.findIndex((h) => h.id === id);
      if (idx >= 0) rt.habits[idx] = updated;
      return updated;
    }
    case "propose_entries": {
      const list = Array.isArray(args.entries) ? args.entries : [];
      const accepted: ProposedEntry[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const p = normalizeProposal(item as Record<string, unknown>, rt.skills, rt.habits);
        if (!p) continue;
        rt.proposals.set(p.id, p);
        accepted.push(p);
      }
      return {
        proposed: accepted.map((p) => ({
          id: p.id,
          entry_type: p.entry_type,
          provenance: p.provenance,
          auto_commit: p.auto_commit,
          needs_skill: p.entry_type === "SKILL_SESSION" && !p.skill_id,
          needs_habit: p.entry_type === "HABIT_LOG" && !p.habit_id,
        })),
        hint: "Show the user confirm cards. Do not claim they were saved unless commit_entries ran or auto_commit applied.",
      };
    }
    case "commit_entries": {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const saved: string[] = [];
      const errors: string[] = [];
      for (const id of ids) {
        const p = rt.proposals.get(id);
        if (!p) {
          errors.push(`${id}: unknown proposal`);
          continue;
        }
        if (p.provenance === "agent_inferred") {
          errors.push(`${id}: inferred scores cannot auto-commit`);
          continue;
        }
        try {
          const res = await commitProposedEntry(p, rt.kek, {
            source_turn_id: rt.sourceTurnId,
            user_confirmed: true,
          });
          saved.push(res.id);
          rt.proposals.delete(id);
        } catch (e) {
          errors.push(`${id}: ${(e as Error).message}`);
        }
      }
      return { saved, errors };
    }
    case "show_chart": {
      const spec = asChartSpec(args);
      spec.habit_id = resolveNamedId(rt.habits, args.habit_id, args.habit_name) ?? spec.habit_id;
      spec.skill_id = resolveNamedId(rt.skills, args.skill_id, args.skill_name) ?? spec.skill_id;
      rt.charts.push(spec);
      return { ok: true, spec, note: "UI will render the chart. Do not draw ASCII." };
    }
    case "pin_chart": {
      const spec = asChartSpec(args);
      const id = await pinChartSpec(JSON.stringify(spec));
      return { ok: true, id };
    }
    case "search_entries": {
      const entryType = typeof args.entry_type === "string" ? args.entry_type : undefined;
      const tag = typeof args.tag === "string" ? args.tag : undefined;
      const limit = Math.min(
        typeof args.limit === "number" ? args.limit : rt.settings.decrypt_n,
        rt.settings.decrypt_n,
      );
      let rows = rt.entries;
      if (entryType) rows = rows.filter((e) => e.entry_type === entryType);
      if (tag) {
        const q = tag.toLowerCase();
        rows = rows.filter((e) => (e.tags ?? []).some((t) => t.toLowerCase().includes(q)));
      }
      const slice = rows.slice(0, Math.max(1, limit));
      const wantDecrypt = Boolean(args.decrypt) && rt.settings.context_policy === "decrypt_n";
      const out = [];
      for (const e of slice) {
        const meta = {
          id: e.id,
          entry_type: e.entry_type,
          timestamp: e.timestamp,
          tags: e.tags,
          mood_score: e.mood_score,
          energy_score: e.energy_score,
          anxiety_score: e.anxiety_score,
          sleep_hours: e.sleep_hours,
          sleep_quality: e.sleep_quality,
        };
        if (wantDecrypt) {
          try {
            const raw = await decryptEntry(e.encrypted_content, e.encrypted_dek, rt.kek);
            out.push({ ...meta, plaintext: JSON.parse(raw) });
          } catch {
            out.push({ ...meta, plaintext: null });
          }
        } else {
          out.push(meta);
        }
      }
      return { count: slice.length, entries: out };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export function extractFallbackProposals(text: string): Record<string, unknown>[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const blob = fence?.[1] ?? text;
  try {
    const parsed = JSON.parse(blob) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x) => x && typeof x === "object") as Record<
      string,
      unknown
    >[];
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)) {
      return ((parsed as { entries: unknown[] }).entries ?? []).filter(
        (x) => x && typeof x === "object",
      ) as Record<string, unknown>[];
    }
  } catch {
    /* ignore */
  }
  return [];
}
