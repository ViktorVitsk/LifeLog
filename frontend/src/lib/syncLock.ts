let tail: Promise<unknown> = Promise.resolve();

/** Serialize flush/sync so a manual send and the background tick cannot race. */
export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
