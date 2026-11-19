import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { saveBrief, setBriefOutDirForTest } from "./save.ts";
import type { Brief } from "./schema.ts";

describe("saveBrief", () => {
  it("writes json and md", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brief-"));
    setBriefOutDirForTest(dir);
    const brief = {
      market: "DE",
      conclusion: "x",
      rows: [],
      gaps: [],
      failures: [],
      truncated: false,
      markdown: "### 结论\nx\n",
    } satisfies Brief;
    const out = saveBrief(brief);
    assert.equal(readFileSync(out.jsonPath, "utf8").includes('"market": "DE"'), true);
    assert.equal(readFileSync(out.mdPath, "utf8"), brief.markdown);
    setBriefOutDirForTest(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects invalid brief before writing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brief-"));
    setBriefOutDirForTest(dir);
    const brief = {
      market: "DE",
      conclusion: "x",
      rows: [
        {
          id: "B0",
          title: "Tray",
          priceEur: null,
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
      gaps: [],
      failures: [],
      truncated: false,
      markdown: "Tray 售价约 €19.99",
    } satisfies Brief;
    assert.throws(() => saveBrief(brief), /validateBrief|臆造欧元价/);
    setBriefOutDirForTest(null);
    rmSync(dir, { recursive: true, force: true });
  });
});
