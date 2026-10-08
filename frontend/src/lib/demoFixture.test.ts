import assert from "node:assert/strict";
import { it } from "node:test";
import { demoCheckins, DEMO_TAG } from "../demo/fixtures.ts";

it("demo observations are explicit fictional fixtures with bounded metrics and distinct days", () => {
  const rows = demoCheckins(new Date("2026-10-09T09:00:00Z"));
  assert.equal(rows.length, 14);
  assert.equal(new Set(rows.map((row) => row.timestamp)).size, 14);
  for (const row of rows) {
    assert.equal(row.plaintext.fictional_demo, true);
    assert.match(row.plaintext.notes, /^\[FICTIONAL DEMO\]/);
    assert.deepEqual(row.openFields.tags, [DEMO_TAG]);
    assert.ok(row.openFields.mood_score >= 1 && row.openFields.mood_score <= 10);
  }
});
