import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveReport, selectIncludeRewrites } from "./save.ts";

const base = {
  rows: [
    { id: "r1", priority: "must" as const, requirement: "TS", status: "met" as const, evidence: "3 年 TypeScript" },
  ],
  gaps: [],
};

test("save rejects missing includeRewrites", () => {
  assert.throws(
    () => saveReport({ ...base, includeRewrites: undefined as unknown as boolean }),
    /includeRewrites/i,
  );
});

test("save rejects invalid match (empty evidence on met)", () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "resume-jd-"));
  try {
    assert.throws(
      () =>
        saveReport({
          includeRewrites: false,
          gaps: [],
          rows: [{ id: "r1", priority: "must", requirement: "x", status: "met", evidence: "" }],
        }, { outDir }),
      /validation failed/,
    );
    assert.equal(existsSync(path.join(outDir, "match")), false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("selectIncludeRewrites + save writes md/json", () => {
  const batch = selectIncludeRewrites(base, false);
  const outDir = mkdtempSync(path.join(os.tmpdir(), "resume-jd-"));
  try {
    const saved = saveReport(batch, { outDir });
    assert.match(saved.mdPath, /match/);
    assert.ok(readFileSync(saved.mdPath, "utf8").length > 0);
    assert.ok(readFileSync(saved.jsonPath, "utf8").includes("r1"));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("includeRewrites gate: true composes, false drops rewrites", () => {
  const match = {
    rows: [
      { id: "r2", priority: "nice" as const, requirement: "带队经验", status: "partial" as const, evidence: "带过 2 人小组" },
    ],
    gaps: [],
  };
  const outDir = mkdtempSync(path.join(os.tmpdir(), "resume-jd-"));
  try {
    const on = saveReport(selectIncludeRewrites(match, true), { outDir, now: new Date(1) });
    assert.match(readFileSync(on.mdPath, "utf8"), /改写建议/);
    assert.ok(JSON.parse(readFileSync(on.jsonPath, "utf8")).rewrites.length === 1);

    const off = saveReport(
      selectIncludeRewrites(match, false, [{ reqId: "r2", before: "a", after: "b", evidence: "a" }]),
      { outDir, now: new Date(2) },
    );
    assert.doesNotMatch(readFileSync(off.mdPath, "utf8"), /改写建议/);
    assert.equal(JSON.parse(readFileSync(off.jsonPath, "utf8")).rewrites, undefined);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
