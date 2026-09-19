import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authResultStillCurrent } from "./authSession.ts";

function fakeJwt(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub }), "utf8").toString("base64url");
  return `hdr.${payload}.sig`;
}

describe("stale auth results", () => {
  it("drops a delayed token after logout then login B", () => {
    const tokenA = fakeJwt("user-a");
    const tokenB = fakeJwt("user-b");
    assert.equal(
      authResultStillCurrent({
        token: tokenA,
        expectedUserId: "user-a",
        opGen: 1,
        currentGen: 3,
        currentUserId: "user-b",
      }),
      false,
    );
    assert.equal(
      authResultStillCurrent({
        token: tokenB,
        expectedUserId: "user-b",
        opGen: 3,
        currentGen: 3,
        currentUserId: "user-b",
      }),
      true,
    );
    assert.equal(
      authResultStillCurrent({
        token: tokenA,
        expectedUserId: "user-b",
        opGen: 3,
        currentGen: 3,
        currentUserId: "user-b",
      }),
      false,
    );
  });
});
