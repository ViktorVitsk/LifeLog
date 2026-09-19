import type { LifeOp, PendingEntry, PendingLife } from "./offlineQueue.ts";

export interface TestQueue {
  entries: Map<string, PendingEntry>;
  life: Map<string, PendingLife>;
  ops: Map<string, LifeOp>;
}

let installed: TestQueue | null = null;

export function installTestQueue(): TestQueue {
  installed = { entries: new Map(), life: new Map(), ops: new Map() };
  return installed;
}

export function uninstallTestQueue(): void {
  installed = null;
}

export function getTestQueue(): TestQueue | null {
  return installed;
}
