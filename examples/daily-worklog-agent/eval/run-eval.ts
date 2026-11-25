/**
 * daily-worklog-agent 无模型评测：fixture 日卡 + 缺源 gaps + 编造门禁。
 *
 *   pnpm eval
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeBundle } from "../lib/compose.ts";
import { saveDayCard } from "../lib/save.ts";
import { summarizeFromBundle } from "../lib/summarize.ts";
import type { DayBundle } from "../lib/schema.ts";

const ROOT = path.join(import.meta.dirname, "..");
const bundle = JSON.parse(
  readFileSync(path.join(ROOT, "data/fixtures/bundle-sample.json"), "utf8"),
) as DayBundle;

let failed = 0;
function fail(msg: string): void {
  console.error("FAIL:", msg);
  failed++;
}

const outDir = mkdtempSync(path.join(os.tmpdir(), "daily-worklog-eval-"));
try {
  const { markdown } = saveDayCard(bundle, summarizeFromBundle(bundle), { outDir });
  if (markdown.includes("evil.example")) fail("日卡不应含 evil.example");
  if (!markdown.includes("abc1234")) fail("日卡应含 abc1234");
  if (!markdown.includes("github.com")) fail("日卡应含 github.com");

  let threw = false;
  try {
    saveDayCard(bundle, "访问了 https://evil.example/x", { outDir });
  } catch {
    threw = true;
  }
  if (!threw) fail("summary 含 bundle 外 URL 应被拒绝");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

const missing = composeBundle({
  date: bundle.date,
  git: bundle.git,
  cursor: bundle.cursor,
  gaps: ["browser: history db not found (auto-detect failed)"],
});
if (missing.gaps.length === 0) fail("缺 browser 的 bundle gaps 应非空");

if (failed > 0) {
  console.error(`eval failed (${failed} assertion(s))`);
  process.exit(1);
}
console.log("eval ok");
