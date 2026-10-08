/** Registration only: legacy logins keep the full password for KEK derivation. */
export function registrationPasswordTooLong(password: string): boolean {
  return new TextEncoder().encode(password).length > 72;
}
