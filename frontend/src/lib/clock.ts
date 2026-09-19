let frozen: Date | null = null;

export function now(): Date {
  return frozen ? new Date(frozen.getTime()) : new Date();
}

export function setNowForTests(value: Date | null): void {
  frozen = value;
}
