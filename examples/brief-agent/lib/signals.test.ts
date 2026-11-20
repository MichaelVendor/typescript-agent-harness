import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSignalsFromPage } from "./signals.ts";
import { loadMockCatalog } from "./fetch.ts";

describe("extractSignalsFromPage", () => {
  it("builds ≥3 evidence and preserves null price", () => {
    const gap = loadMockCatalog().find((p) => p.id === "GAP1")!;
    const sig = extractSignalsFromPage(gap);
    const all = [
      ...sig.buckets.pricing.evidence,
      ...sig.buckets.positioning.evidence,
      ...sig.buckets.reviews.evidence,
      ...sig.buckets.changes.evidence,
    ];
    assert.ok(all.length >= 3);
    assert.equal(sig.buckets.pricing.priceEur, null);
  });

  it("puts Rost in themes and edel in pros", () => {
    const b002 = loadMockCatalog().find((p) => p.id === "B002")!;
    const sig = extractSignalsFromPage(b002);
    assert.ok(sig.buckets.reviews.themes.includes("Rost an Kante"));
    assert.ok(sig.buckets.reviews.themes.includes("schwer"));
    assert.equal(sig.buckets.reviews.themes.includes("sieht edel aus"), false);
    assert.ok(sig.buckets.reviews.pros.includes("sieht edel aus"));
  });

  it("does not treat guter Preis as a cons theme", () => {
    const b001 = loadMockCatalog().find((p) => p.id === "B001")!;
    const sig = extractSignalsFromPage(b001);
    assert.equal(sig.buckets.reviews.themes.includes("guter Preis"), false);
    assert.ok(sig.buckets.reviews.pros.includes("guter Preis"));
    assert.deepEqual(sig.buckets.reviews.themes, ["etwas klein"]);
  });
});
