import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchProductPages } from "./fetch.ts";

describe("fetchProductPages", () => {
  it("returns pages for known ids", async () => {
    const out = await fetchProductPages({ ids: ["B001", "B002"] });
    assert.equal(out.pages.length, 2);
    assert.equal(out.failures.length, 0);
    assert.equal(out.pages[0]?.priceEur, 24.99);
  });

  it("records failures for missing or injected fail ids", async () => {
    const out = await fetchProductPages({ ids: ["B001", "NOPE"], failIds: ["B001"] });
    assert.equal(out.pages.length, 0);
    assert.ok(out.failures.some((f) => f.id === "B001"));
    assert.ok(out.failures.some((f) => f.id === "NOPE"));
  });

  it("keeps null price for GAP1", async () => {
    const out = await fetchProductPages({ ids: ["GAP1"] });
    assert.equal(out.pages[0]?.priceEur, null);
  });
});