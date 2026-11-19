import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFailureId,
  assertGapSubstring,
  assertMinEvidence,
  assertNoEuroOnTitles,
  assertRowIds,
  assertValidateOutcome,
  markdownScope,
} from "./assert-brief.ts";
import type { Brief } from "../lib/schema.ts";

function sampleBrief(over: Partial<Brief> = {}): Brief {
  return {
    market: "DE",
    conclusion: "x",
    rows: [
      {
        id: "GAP1",
        title: "Bambus Tablett (缺价)",
        priceEur: null,
        rank: null,
        bullets: ["Bambus"],
        reviewThemes: [],
        changes: [],
        evidence: [
          { claim: "a", source: "m", detail: "1" },
          { claim: "b", source: "m", detail: "2" },
          { claim: "c", source: "m", detail: "3" },
        ],
      },
      {
        id: "B001",
        title: "Dekotablett Holz 30cm",
        priceEur: 24.99,
        rank: null,
        bullets: [],
        reviewThemes: [],
        changes: [],
        evidence: [
          { claim: "a", source: "m", detail: "1" },
          { claim: "b", source: "m", detail: "2" },
          { claim: "c", source: "m", detail: "3" },
        ],
      },
    ],
    gaps: ["缺价格: GAP1"],
    failures: [],
    truncated: false,
    markdown: [
      "| GAP1 | Bambus Tablett (缺价) | 缺数据 | Bambus |",
      "| B001 | Dekotablett Holz 30cm | €24.99 | Akazie |",
    ].join("\n"),
    ...over,
  };
}

describe("assert-brief", () => {
  it("markdownScope keeps peer € off Bambus lines", () => {
    const brief = sampleBrief();
    const scope = markdownScope(brief.markdown, "Bambus Tablett");
    assert.equal(/€/.test(scope), false);
    assert.ok(markdownScope(brief.markdown, "Dekotablett").includes("€24.99"));
  });

  it("assertNoEuroOnTitles passes when only peer has €", () => {
    const brief = sampleBrief();
    assert.equal(assertNoEuroOnTitles(brief.markdown, ["Bambus Tablett"]).ok, true);
  });

  it("assertNoEuroOnTitles fails when Bambus line invents €", () => {
    const bad = sampleBrief({
      markdown: "| GAP1 | Bambus Tablett (缺价) | €9.99 | Bambus |",
    });
    assert.equal(assertNoEuroOnTitles(bad.markdown, ["Bambus Tablett"]).ok, false);
  });

  it("assertGapSubstring / evidence / rows / failures", () => {
    const brief = sampleBrief({
      rows: sampleBrief().rows.filter((r) => r.id === "GAP1"),
      failures: [{ id: "B001", stage: "fetch", message: "x" }],
    });
    assert.equal(assertGapSubstring(brief, "缺价格").ok, true);
    assert.equal(assertMinEvidence(brief, 3).ok, true);
    assert.equal(assertRowIds(brief, ["GAP1"]).ok, true);
    assert.equal(assertFailureId(brief, "B001").ok, true);
  });

  it("assertValidateOutcome mirrors expectValidateFail", () => {
    assert.equal(assertValidateOutcome([{ path: "markdown", message: "x" }], true).ok, true);
    assert.equal(assertValidateOutcome([], true).ok, false);
    assert.equal(assertValidateOutcome([], false).ok, true);
  });
});
