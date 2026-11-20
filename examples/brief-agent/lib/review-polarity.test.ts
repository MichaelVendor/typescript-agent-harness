import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifySnippet, splitReviewSnippets } from "./review-polarity.ts";

describe("classifySnippet", () => {
  it("classifies DE/EN polarity with neg priority", () => {
    assert.equal(classifySnippet("Rost an Kante"), "neg");
    assert.equal(classifySnippet("guter Preis"), "pos");
    assert.equal(classifySnippet("leicht zerkratzt"), "neg");
    assert.equal(classifySnippet("meh"), "neutral");
  });
});

describe("splitReviewSnippets", () => {
  it("dedupes case-insensitively within buckets", () => {
    const { cons } = splitReviewSnippets(["etwas klein", "ETWAS KLEIN", "schön"]);
    assert.deepEqual(cons, ["etwas klein"]);
  });
});
