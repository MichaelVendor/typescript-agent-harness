import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { saveBrief, setBriefOutDirForTest } from "./save.ts";
import type { Brief } from "./schema.ts";

describe("saveBrief", () => {
  it("writes json and md and appends tasks.jsonl", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brief-"));
    setBriefOutDirForTest(dir);
    const brief = {
      market: "DE",
      conclusion: "x",
      rows: [
        {
          id: "B1",
          title: "Tray",
          priceEur: 10,
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
      template: "exec",
      markdown: "### 结论\nx\n",
    } satisfies Brief;
    const now = new Date("2026-11-20T08:00:00.000Z");
    const out = saveBrief(brief, { now });
    assert.equal(readFileSync(out.jsonPath, "utf8").includes('"market": "DE"'), true);
    assert.equal(readFileSync(out.mdPath, "utf8"), brief.markdown);
    assert.equal(out.taskLogged, true);
    assert.equal(out.tasksPath, path.join(dir, "tasks.jsonl"));
    const line = readFileSync(out.tasksPath, "utf8").trim();
    const rec = JSON.parse(line) as {
      ts: string;
      template: string;
      rowIds: string[];
      source: string;
      rowCount: number;
      truncated: boolean;
      market: string;
    };
    assert.equal(rec.ts, "2026-11-20T08:00:00.000Z");
    assert.equal(rec.template, "exec");
    assert.deepEqual(rec.rowIds, ["B1"]);
    assert.equal(rec.source, "mock");
    assert.equal(rec.rowCount, 1);
    assert.equal(rec.truncated, false);
    assert.equal(rec.market, "DE");
    setBriefOutDirForTest(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects invalid brief before writing and does not append tasks", () => {
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
    assert.equal(existsSync(path.join(dir, "tasks.jsonl")), false);
    setBriefOutDirForTest(null);
    rmSync(dir, { recursive: true, force: true });
  });
});
