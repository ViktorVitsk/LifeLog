import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authErrorStillCurrent, authResultStillCurrent, jwtSubjectMatches } from "./authSession.ts";

function fakeJwt(payload: Record<string, unknown>): string {
  const json = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `hdr.${json}.sig`;
}

describe("stale auth results", () => {
  it("drops a delayed token after logout then login B", () => {
    const tokenA = fakeJwt({ sub: "user-a" });
    const tokenB = fakeJwt({ sub: "user-b" });
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

  it("does not treat a missing or invalid JWT sub as an owner match", () => {
    assert.equal(jwtSubjectMatches("not-a-jwt", "user-a"), false);
    assert.equal(jwtSubjectMatches(fakeJwt({}), "user-a"), false);
    assert.equal(jwtSubjectMatches(fakeJwt({ sub: 12 }), "user-a"), false);
    assert.equal(jwtSubjectMatches(fakeJwt({ sub: "" }), "user-a"), false);
    assert.equal(
      authResultStillCurrent({
        token: fakeJwt({}),
        expectedUserId: "user-a",
        opGen: 1,
        currentGen: 1,
        currentUserId: "user-a",
      }),
      false,
    );
    assert.equal(jwtSubjectMatches(fakeJwt({ sub: "user-a" }), "user-a"), true);
  });

  it("ignores a late auth error from A after B is signed in", () => {
    assert.equal(
      authErrorStillCurrent({
        opGen: 1,
        currentGen: 4,
        expectedUserId: "user-a",
        currentUserId: "user-b",
      }),
      false,
    );
    assert.equal(
      authErrorStillCurrent({
        opGen: 4,
        currentGen: 4,
        expectedUserId: "user-b",
        currentUserId: "user-b",
      }),
      true,
    );
  });

  it("does not expire a logged-out session from a stale refresh error", () => {
    assert.equal(
      authErrorStillCurrent({
        opGen: 2,
        currentGen: 3,
        expectedUserId: "user-a",
        currentUserId: null,
      }),
      false,
    );
  });

  it("ignores an old error after the same account starts a new session", () => {
    assert.equal(
      authErrorStillCurrent({
        opGen: 2,
        currentGen: 5,
        expectedUserId: "user-a",
        currentUserId: "user-a",
      }),
      false,
    );
  });

  it("ignores AUTH_EXPIRED, cancelled unlock, and late reauthenticate errors from a previous gen", () => {
    const stale = { opGen: 7, currentGen: 8, expectedUserId: "user-a", currentUserId: "user-a" };
    assert.equal(authErrorStillCurrent(stale), false);
    assert.equal(authErrorStillCurrent({ ...stale, currentGen: 7, currentUserId: null }), false);
    assert.equal(
      authResultStillCurrent({
        token: fakeJwt({ sub: "user-a" }),
        expectedUserId: "user-a",
        opGen: 7,
        currentGen: 8,
        currentUserId: "user-a",
      }),
      false,
    );
  });
});
