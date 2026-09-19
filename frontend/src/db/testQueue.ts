import type { LifeOp, PendingEntry, PendingLife } from "./offlineQueue.ts";

export interface TestQueue {
  entries: Map<string, PendingEntry>;
  life: Map<string, PendingLife>;
  ops: Map<string, LifeOp>;
  runTx<T>(fn: () => Promise<T> | T): Promise<T>;
}

function createTestQueue(): TestQueue {
  let chain = Promise.resolve();
  return {
    entries: new Map(),
    life: new Map(),
    ops: new Map(),
    runTx(fn) {
      const run = chain.then(() => fn());
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

let installed: TestQueue | null = null;

export function installTestQueue(): TestQueue {
  installed = createTestQueue();
  return installed;
}

export function uninstallTestQueue(): void {
  installed = null;
}

export function getTestQueue(): TestQueue | null {
  return installed;
}
