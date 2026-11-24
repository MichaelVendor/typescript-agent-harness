/**
 * resume-jd-agent 无模型评测：fixture 黄金路径 + 不编造 + includeRewrites 门禁 + 脏数据门禁。
 *
 *   pnpm eval
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePair } from "../lib/parse.ts";
import { matchRequirements } from "../lib/match.ts";
import { composeRewrites } from "../lib/rewrite.ts";
import { saveReport, selectIncludeRewrites } from "../lib/save.ts";
import { validateMatchResult, type MatchBatch, type MatchResult } from "../lib/schema.ts";

const ROOT = path.join(import.meta.dirname, "..");
const fixture = readFileSync(path.join(ROOT, "data/fixtures/pair-zh.txt"), "utf8");

let failed = 0;
function fail(msg: string): void {
  console.error("FAIL:", msg);
  failed++;
}

const parsed = parsePair(fixture);
const match = matchRequirements(parsed);

// 1. validate + must/nice + Kubernetes missing
if (validateMatchResult(match).length > 0) fail("fixture match 应通过 validateMatchResult");
if (!match.rows.some((r) => r.priority === "must")) fail("fixture 应含 must");
if (!match.rows.some((r) => r.priority === "nice")) fail("fixture 应含 nice");
const k8s = match.rows.find((r) => r.requirement.includes("Kubernetes"));
if (!k8s) fail("fixture 应含 Kubernetes 要求");
else if (k8s.status !== "missing" || k8s.evidence !== null) {
  fail("Kubernetes 应为 missing 且 evidence 为 null");
}

// 2. rewrites 不含 Kubernetes
const { rewrites } = composeRewrites(match);
if (k8s && rewrites.some((w) => w.reqId === k8s.id)) fail("rewrites 不应含 Kubernetes 行");
if (rewrites.some((w) => w.before.includes("Kubernetes") || w.after.includes("Kubernetes"))) {
  fail("rewrites 文本不应出现 Kubernetes");
}

// 3. met/partial 的 evidence 来自简历 bullet
const bullets = parsed.resumeBullets.map((b) => b.trim());
for (const row of match.rows) {
  if (row.status === "missing") continue;
  const ev = (row.evidence ?? "").trim();
  if (ev === "" || !bullets.some((b) => b === ev || b.includes(ev))) {
    fail(`row ${row.id} evidence 不是简历 bullet: ${row.evidence}`);
  }
}

// 4. includeRewrites 门禁
const noChoice = { ...match } as unknown as MatchBatch;
let threw = false;
try {
  saveReport(noChoice);
} catch {
  threw = true;
}
if (!threw) fail("无 includeRewrites 的 save 应抛错");

const outDir = mkdtempSync(path.join(os.tmpdir(), "resume-jd-eval-"));
try {
  for (const include of [false, true]) {
    const saved = saveReport(
      selectIncludeRewrites(match, include, include ? rewrites : undefined),
      { outDir, now: new Date(Date.now() + (include ? 1 : 0)) },
    );
    if (!existsSync(saved.mdPath) || !existsSync(saved.jsonPath)) {
      fail(`includeRewrites=${include} 后 save 应写出 md/json`);
    }
  }
} catch (e) {
  fail(`save 黄金路径: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// 5. 脏数据：met + 空 evidence
const dirty: MatchResult = {
  rows: [{ id: "x1", priority: "must", requirement: "无证据要求", status: "met", evidence: "" }],
  gaps: [],
};
if (validateMatchResult(dirty).length === 0) fail("met + 空 evidence 应被 validateMatchResult 拒绝");
let dirtyThrew = false;
try {
  saveReport(selectIncludeRewrites(dirty, false), { outDir: os.tmpdir() });
} catch {
  dirtyThrew = true;
}
if (!dirtyThrew) fail("met + 空 evidence 应被 save 拒绝");

if (failed > 0) {
  console.error(`eval failed (${failed} assertion(s))`);
  process.exit(1);
}
console.log("eval ok");
