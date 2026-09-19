export const USER_A = "00000000-0000-4000-8000-00000000000a";
export const USER_B = "00000000-0000-4000-8000-00000000000b";

function token(sub: string, marker: string): string {
  const payload = btoa(JSON.stringify({ sub, exp: 2_000_000_000 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `e30.${payload}.${marker}`;
}

export const TOKEN_A = token(USER_A, "a");
export const TOKEN_A_LATE = token(USER_A, "a-late");
export const TOKEN_A_REFRESH = token(USER_A, "a-refresh");
export const TOKEN_B = token(USER_B, "b");
