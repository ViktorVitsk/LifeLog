let tail: Promise<unknown> = Promise.resolve();

function withTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Same-tab Promise mutex plus Web Locks so a second tab cannot flush in parallel. */
export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request("lifelog-sync", () => withTabLock(fn)) as Promise<T>;
  }
  return withTabLock(fn);
}
