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

  it("uses whole review snippets as themes (not whitespace tokens)", () => {
    const b001 = loadMockCatalog().find((p) => p.id === "B001")!;
    const sig = extractSignalsFromPage(b001);
    assert.deepEqual(sig.buckets.reviews.themes, b001.reviewSnippets);
    assert.ok(sig.buckets.reviews.themes.includes("schön verarbeitet"));
    assert.equal(sig.buckets.reviews.themes.includes("schön"), false);
  });
});
