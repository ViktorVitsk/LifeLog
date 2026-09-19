import { jwtSub } from "./accountScope.ts";

export function authResultStillCurrent(args: {
  token: string;
  expectedUserId: string;
  opGen: number;
  currentGen: number;
  currentUserId: string | null;
}): boolean {
  if (args.opGen !== args.currentGen) return false;
  if (!args.expectedUserId || args.currentUserId !== args.expectedUserId) return false;
  const sub = jwtSub(args.token);
  return !sub || sub === args.expectedUserId;
}
