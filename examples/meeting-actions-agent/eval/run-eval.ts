/**
 * meeting-actions-agent 无模型评测：fixture 黄金路径 + schema 脏数据门禁。
 *
 *   pnpm eval
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractActions } from "../lib/extract.ts";
import { confirmActions } from "../lib/confirm.ts";
import { composeDraft } from "../lib/compose.ts";
import { saveActions } from "../lib/save.ts";
import { validateExtractResult, type ExtractResult } from "../lib/schema.ts";

const ROOT = path.join(import.meta.dirname, "..");
const fixture = readFileSync(path.join(ROOT, "data/fixtures/standup-zh.txt"), "utf8");

let failed = 0;
function fail(msg: string): void {
  console.error("FAIL:", msg);
  failed++;
}

const extracted = extractActions(fixture);
if (validateExtractResult(extracted).length > 0) {
  fail("fixture extract should pass validateExtractResult");
}

const help = extracted.rows.find((x) => /帮助文档/.test(x.text));
if (!help || help.owner !== null) {
  fail("帮助文档行 owner 必须为 null（无证据不填人名）");
}

const draft = composeDraft(extracted);
const patches = draft.pendingOwnerIds.map((id) => ({
  id,
  owner: "eval-负责人",
  priority: "P2" as const,
}));
const batch = confirmActions(extracted, patches);
const outDir = mkdtempSync(path.join(os.tmpdir(), "meeting-actions-eval-"));
try {
  const saved = saveActions(batch, { outDir });
  if (!existsSync(saved.mdPath) || !existsSync(saved.jsonPath)) {
    fail("save 应写出 md/json");
  }
} catch (e) {
  fail(`save 黄金路径: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

const dirty: ExtractResult = {
  rows: [
    {
      id: "x1",
      kind: "action",
      text: "无证据行动",
      owner: "虚构",
      due: null,
      priority: null,
      evidence: "",
    },
  ],
  gaps: [],
};
const dirtyProblems = validateExtractResult(dirty);
if (dirtyProblems.length === 0) {
  fail("无 evidence 的 row 应被 validateExtractResult 拒绝");
}

if (failed > 0) {
  console.error(`eval failed (${failed} assertion(s))`);
  process.exit(1);
}
console.log("eval ok");