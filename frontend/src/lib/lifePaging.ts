import type { LifeBundle } from "./api";

export async function collectLifePages(
  fetchPage: (offset: number, limit: number) => Promise<LifeBundle>,
  limit = 200,
): Promise<LifeBundle> {
  const combined: LifeBundle = {
    goals: [],
    memory: [],
    actions: [],
    feedback: [],
    due_action_ids: [],
  };
  const due = new Set<string>();
  let offset = 0;

  for (;;) {
    const page = await fetchPage(offset, limit);
    combined.goals.push(...page.goals);
    combined.memory.push(...page.memory);
    combined.actions.push(...page.actions);
    combined.feedback.push(...page.feedback);
    for (const id of page.due_action_ids) due.add(id);

    if (page.next_offset == null) {
      combined.due_action_ids = [...due];
      return combined;
    }
    if (page.next_offset <= offset) {
      throw new Error("invalid_life_next_offset");
    }
    offset = page.next_offset;
  }
}
