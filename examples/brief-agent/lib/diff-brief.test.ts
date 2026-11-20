import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { diffBriefRows, findPreviousBrief } from "./diff-brief.ts";
import type { Brief, BriefRow } from "./schema.ts";

function row(partial: Partial<BriefRow> & { id: string }): BriefRow {
  return {
    title: partial.title ?? partial.id,
    priceEur: partial.priceEur ?? null,
    rank: null,
    bullets: partial.bullets ?? [],
    reviewThemes: partial.reviewThemes ?? [],
    changes: [],
    evidence: [
      { claim: "a", source: "t", detail: "1" },
      { claim: "b", source: "t", detail: "2" },
      { claim: "c", source: "t", detail: "3" },
    ],
    ...partial,
  };
}

function brief(rows: BriefRow[]): Brief {
  return {
    market: "DE",
    conclusion: "x",
    rows,
    gaps: [],
    failures: [],
    truncated: false,
    markdown: "### 结论\nx\n",
  };
}

describe("diffBriefRows", () => {
  it("reports price change", () => {
    const prev = brief([row({ id: "B001", priceEur: 24.99, bullets: ["a"] })]);
    const curr = [row({ id: "B001", priceEur: 22.0, bullets: ["a"] })];
    const lines = diffBriefRows(prev, curr);
    assert.ok(lines.some((l) => l.includes("价格") && l.includes("→")));
  });

  it("reports no previous", () => {
    assert.deepEqual(diffBriefRows(null, [row({ id: "B001" })]), ["无上次简报可对比"]);
  });
});

describe("findPreviousBrief", () => {
  it("finds latest matching id set", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brief-diff-"));
    try {
      const older = brief([row({ id: "B001", priceEur: 10 })]);
      const newer = brief([row({ id: "B001", priceEur: 20 })]);
      writeFileSync(path.join(dir, "2020-01-01T00-00-00-000Z.json"), JSON.stringify(older));
      writeFileSync(path.join(dir, "2021-01-01T00-00-00-000Z.json"), JSON.stringify(newer));
      const found = findPreviousBrief(dir, ["B001"]);
      assert.equal(found?.rows[0]?.priceEur, 20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when no match", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brief-diff-"));
    try {
      writeFileSync(
        path.join(dir, "2021-01-01T00-00-00-000Z.json"),
        JSON.stringify(brief([row({ id: "OTHER" })])),
      );
      assert.equal(findPreviousBrief(dir, ["B001"]), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
