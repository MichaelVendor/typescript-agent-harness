import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveReport, selectTemplate } from "./save.ts";

const base = {
  items: [
    { id: "i1", section: "done" as const, text: "x", evidence: "e" },
  ],
  gaps: [],
};

test("save rejects missing template", () => {
  assert.throws(
    () => saveReport({ ...base, template: undefined as unknown as "ops" }),
    /template required/i,
  );
});

test("save rejects invalid template and writes nothing", () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "weekly-report-"));
  try {
    assert.throws(
      () => saveReport({ ...base, template: "bogus" as unknown as "ops" }, { outDir }),
      /template required/i,
    );
    assert.equal(existsSync(path.join(outDir, "reports")), false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("selectTemplate + save writes md/json", () => {
  const batch = selectTemplate(base, "ops");
  assert.equal(batch.template, "ops");
  const outDir = mkdtempSync(path.join(os.tmpdir(), "weekly-report-"));
  try {
    const saved = saveReport(batch, { outDir, now: new Date("2026-11-24T08:00:00.000Z") });
    assert.match(saved.mdPath, /reports/);
    assert.match(saved.mdPath, /2026-11-24T08-00-00-000Z\.md$/);
    const md = readFileSync(saved.mdPath, "utf8");
    assert.match(md, /## 完成/);
    assert.match(md, /x/);
    assert.ok(readFileSync(saved.jsonPath, "utf8").includes("i1"));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("save rejects invalid batch (empty evidence) and writes nothing", () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "weekly-report-"));
  try {
    const bad = {
      items: [{ id: "i1", section: "done" as const, text: "x", evidence: "" }],
      gaps: [],
      template: "ops" as const,
    };
    assert.throws(() => saveReport(bad, { outDir }), /validation failed.*evidence/i);
    assert.equal(existsSync(path.join(outDir, "reports")), false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
