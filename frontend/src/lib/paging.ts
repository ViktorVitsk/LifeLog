export async function collectPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; next_offset: number | null }>,
  limit = 200,
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let offset = 0;
  let pages = 0;
  for (;;) {
    const page = await fetchPage(offset, limit);
    pages += 1;
    items.push(...page.items);
    if (page.next_offset == null) break;
    offset = page.next_offset;
  }
  return { items, pages };
}

export async function collectArrayPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  limit = 200,
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let offset = 0;
  let pages = 0;
  for (;;) {
    const page = await fetchPage(offset, limit);
    pages += 1;
    items.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return { items, pages };
}
