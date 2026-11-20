import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrief, type Brief } from "./schema.ts";
import { activeSource } from "./sources/index.ts";

export const PROJECT_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

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

function resolveTasksPath(): string {
  if (outDirOverride) return path.join(outDirOverride, "tasks.jsonl");
  return path.join(PROJECT_ROOT, "out", "tasks.jsonl");
}

export type TaskRecord = {
  ts: string;
  template: "ops" | "exec";
  rowIds: string[];
  jsonPath: string;
  mdPath: string;
  source: "mock" | "live";
  market: "DE";
  truncated: boolean;
  rowCount: number;
};

export function saveBrief(
  brief: Brief,
  opts?: { now?: Date },
): {
  jsonPath: string;
  mdPath: string;
  markdown: string;
  tasksPath: string;
  taskLogged: true;
} {
  const problems = validateBrief(brief);
  if (problems.length > 0) {
    const detail = problems.map((p) => `${p.path}: ${p.message}`).join("; ");
    throw new Error(`validateBrief failed: ${detail}`);
  }

  const now = opts?.now ?? new Date();
  const ts = now.toISOString();
  const dir = resolveOutDir();
  mkdirSync(dir, { recursive: true });
  const stamp = briefStamp(ts);
  const jsonPath = path.join(dir, `${stamp}.json`);
  const mdPath = path.join(dir, `${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, brief.markdown, "utf8");

  const tasksPath = resolveTasksPath();
  mkdirSync(path.dirname(tasksPath), { recursive: true });
  const record: TaskRecord = {
    ts,
    template: brief.template === "exec" ? "exec" : "ops",
    rowIds: brief.rows.map((r) => r.id),
    jsonPath,
    mdPath,
    source: activeSource().name,
    market: brief.market,
    truncated: brief.truncated,
    rowCount: brief.rows.length,
  };
  appendFileSync(tasksPath, `${JSON.stringify(record)}\n`, "utf8");

  return {
    jsonPath,
    mdPath,
    markdown: brief.markdown,
    tasksPath,
    taskLogged: true,
  };
}
