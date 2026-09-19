export function knownIso(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value !== "unknown" ? value : null;
}

export function versionNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** True when incoming is strictly older than the copy we already trust. */
export function isStaleVersion(incoming: unknown, held: unknown): boolean {
  const next = versionNumber(incoming);
  const prev = versionNumber(held);
  return next != null && prev != null && next < prev;
}

export function firstKnownIso(...values: unknown[]): string | null {
  for (const value of values) {
    const iso = knownIso(value);
    if (iso) return iso;
  }
  return null;
}

export function nowIso(at = Date.now()): string {
  return new Date(at).toISOString();
}
