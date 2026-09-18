import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectArrayPages, collectPages } from "./paging.ts";

describe("B5 export paging", () => {
  it("walks every page until next_offset is null", async () => {
    const pages = [
      { items: [1, 2], next_offset: 2 },
      { items: [3], next_offset: null },
    ];
    const result = await collectPages(async (offset) => pages[offset === 0 ? 0 : 1], 2);
    assert.deepEqual(result.items, [1, 2, 3]);
    assert.equal(result.pages, 2);
  });

  it("stops a list page when it is shorter than the limit", async () => {
    const result = await collectArrayPages(async (offset) => (offset === 0 ? [1, 2] : [3]), 2);
    assert.deepEqual(result.items, [1, 2, 3]);
    assert.equal(result.pages, 2);
  });
});
