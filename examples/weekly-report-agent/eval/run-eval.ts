/**
 * weekly-report-agent 无模型评测：fixture 黄金路径 + 模板分流 + schema 脏数据门禁。
 *
 *   pnpm eval
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractItems } from "../lib/extract.ts";
import { renderReport } from "../lib/render.ts";
import { saveReport, selectTemplate } from "../lib/save.ts";
import {
  validateExtractResult,
  type ExtractResult,
  type ReportBatch,
} from "../lib/schema.ts";

const ROOT = path.join(import.meta.dirname, "..");
const fixture = readFileSync(path.join(ROOT, "data/fixtures/notes-zh.txt"), "utf8");

let failed = 0;
function fail(msg: string): void {
  console.error("FAIL:", msg);
  failed++;
}

const extracted = extractItems(fixture);
if (validateExtractResult(extracted).length > 0) {
  fail("fixture extract should pass validateExtractResult");
}
for (const section of ["done", "wip", "risk", "next", "unclassified"] as const) {
  if (!extracted.items.some((i) => i.section === section)) {
    fail(`fixture 应含 section ${section}`);
  }
}

const fixtureOnlyForbidden = ["Jira"];
const allText = JSON.stringify(extracted);
for (const word of fixtureOnlyForbidden) {
  if (!fixture.includes(word) && allText.includes(word)) {
    fail(`抽取结果不应出现 fixture 外关键词 ${word}`);
  }
}

const ops = renderReport(extracted, "ops").markdown;
const mainOps = ops.split("## 缺口")[0] ?? ops;
if (mainOps.includes("拉面")) fail("ops 主表不应含未归类条目「拉面」");
const exec = renderReport(extracted, "exec").markdown;
if (!exec.includes("下周")) fail("exec 应含「下周」");

const noTemplate = { ...extracted } as unknown as ReportBatch;
let threw = false;
try {
  saveReport(noTemplate);
} catch {
  threw = true;
}
if (!threw) fail("无 template 的 save 应抛错");

const outDir = mkdtempSync(path.join(os.tmpdir(), "weekly-report-eval-"));
try {
  const saved = saveReport(selectTemplate(extracted, "ops"), { outDir });
  if (!existsSync(saved.mdPath) || !existsSync(saved.jsonPath)) {
    fail("注入 ops 后 save 应写出 md/json");
  }
} catch (e) {
  fail(`save 黄金路径: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

const dirty: ExtractResult = {
  items: [{ id: "x1", section: "done", text: "无证据事项", evidence: "" }],
  gaps: [],
};
if (validateExtractResult(dirty).length === 0) {
  fail("空 evidence 的 item 应被 validateExtractResult 拒绝");
}

if (failed > 0) {
  console.error(`eval failed (${failed} assertion(s))`);
  process.exit(1);
}
console.log("eval ok");
