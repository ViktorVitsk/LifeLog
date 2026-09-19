import type { PendingEntry, PendingLife } from "./offlineQueue.ts";

export interface TestQueue {
  entries: Map<string, PendingEntry>;
  life: Map<string, PendingLife>;
}

let installed: TestQueue | null = null;

export function installTestQueue(): TestQueue {
  installed = { entries: new Map(), life: new Map() };
  return installed;
}

export function uninstallTestQueue(): void {
  installed = null;
}

export function getTestQueue(): TestQueue | null {
  return installed;
}
