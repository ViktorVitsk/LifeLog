export function assembleMemoryProfile(
  items: { state: string; kind: string; statement?: string }[],
): { kind: string; statement: string }[] {
  return items
    .filter((item) => item.state === "accepted" && item.statement)
    .map((item) => ({ kind: item.kind, statement: item.statement as string }));
}
