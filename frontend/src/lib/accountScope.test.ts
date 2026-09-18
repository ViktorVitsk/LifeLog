import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { partitionOwned, jwtSub, setCurrentUserId, getCurrentUserId } from "./accountScope.ts";

describe("A4 account scope", () => {
  it("does not treat ownerless rows as the current user", () => {
    const { mine, orphans, other } = partitionOwned(
      [
        { id: "1", owner_user_id: "aaa" },
        { id: "2" },
        { id: "3", owner_user_id: "bbb" },
      ],
      "aaa",
    );
    assert.deepEqual(
      mine.map((r) => r.id),
      ["1"],
    );
    assert.deepEqual(
      orphans.map((r) => r.id),
      ["2"],
    );
    assert.deepEqual(
      other.map((r) => r.id),
      ["3"],
    );
  });

  it("reads user id from JWT sub", () => {
    const payload = btoa(JSON.stringify({ sub: "user-uuid-1", exp: 1 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const token = `eyJhbGciOiJub25lIn0.${payload}.x`;
    assert.equal(jwtSub(token), "user-uuid-1");
  });

  it("tracks current user id in memory", () => {
    setCurrentUserId("u1");
    assert.equal(getCurrentUserId(), "u1");
    setCurrentUserId(null);
    assert.equal(getCurrentUserId(), null);
  });
});
