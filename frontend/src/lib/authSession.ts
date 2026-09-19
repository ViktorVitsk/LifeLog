import { jwtSub } from "./accountScope.ts";

export function jwtSubjectMatches(token: string, userId: string): boolean {
  const sub = jwtSub(token);
  if (!sub) return false;
  return sub === userId;
}

export function authErrorStillCurrent(args: {
  opGen: number;
  currentGen: number;
  expectedUserId: string;
  currentUserId: string | null;
}): boolean {
  return (
    args.opGen === args.currentGen &&
    Boolean(args.expectedUserId) &&
    args.currentUserId === args.expectedUserId
  );
}

export function authResultStillCurrent(args: {
  token: string;
  expectedUserId: string;
  opGen: number;
  currentGen: number;
  currentUserId: string | null;
}): boolean {
  if (!authErrorStillCurrent(args)) return false;
  return jwtSubjectMatches(args.token, args.expectedUserId);
}
