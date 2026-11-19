import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrief, type Brief } from "./schema.ts";

const PROJECT_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

let outDirOverride: string | null = null;

/** 仅测试用：把落盘目录指到临时目录；传 null 恢复默认。 */
export function setBriefOutDirForTest(dir: string | null): void {
  outDirOverride = dir;
}

function briefStamp(iso: string): string {
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}

function resolveOutDir(): string {
  return outDirOverride ?? path.join(PROJECT_ROOT, "out", "briefs");
}

export function saveBrief(
  brief: Brief,
  opts?: { now?: Date },
): { jsonPath: string; mdPath: string; markdown: string } {
  const problems = validateBrief(brief);
  if (problems.length > 0) {
    const detail = problems.map((p) => `${p.path}: ${p.message}`).join("; ");
    throw new Error(`validateBrief failed: ${detail}`);
  }

  const dir = resolveOutDir();
  mkdirSync(dir, { recursive: true });
  const stamp = briefStamp((opts?.now ?? new Date()).toISOString());
  const jsonPath = path.join(dir, `${stamp}.json`);
  const mdPath = path.join(dir, `${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, brief.markdown, "utf8");
  return { jsonPath, mdPath, markdown: brief.markdown };
}
