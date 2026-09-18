/** In-memory account scope for Dexie / sync. Set by AuthContext. */

let currentUserId: string | null = null;
let encryptAllowed = false;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

export function requireCurrentUserId(): string {
  if (!currentUserId) throw new Error("account_scope_missing");
  return currentUserId;
}

export function setEncryptAllowed(ok: boolean): void {
  encryptAllowed = ok;
}

export function isEncryptAllowed(): boolean {
  return encryptAllowed;
}

export function assertEncryptAllowed(): void {
  if (!encryptAllowed) throw new Error("kek_unverified");
}

export function jwtSub(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function ownedByCurrentUser<T extends { owner_user_id?: string | null }>(
  row: T,
  userId: string | null = currentUserId,
): boolean {
  return Boolean(userId && row.owner_user_id === userId);
}

export function isOrphanRow<T extends { owner_user_id?: string | null }>(row: T): boolean {
  return row.owner_user_id == null || row.owner_user_id === "";
}

export function partitionOwned<T extends { owner_user_id?: string | null }>(
  rows: T[],
  userId: string | null,
): { mine: T[]; orphans: T[]; other: T[] } {
  const mine: T[] = [];
  const orphans: T[] = [];
  const other: T[] = [];
  for (const row of rows) {
    if (isOrphanRow(row)) orphans.push(row);
    else if (userId && row.owner_user_id === userId) mine.push(row);
    else other.push(row);
  }
  return { mine, orphans, other };
}
