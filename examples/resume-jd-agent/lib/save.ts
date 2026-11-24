import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMatchReport } from "./render.ts";
import { composeRewrites } from "./rewrite.ts";
import { validateMatchResult } from "./schema.ts";
import type { MatchBatch, MatchResult, RewriteItem } from "./schema.ts";

export const PROJECT_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

function stampOf(iso: string): string {
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}

export function selectIncludeRewrites(
  match: MatchResult,
  includeRewrites: boolean,
  rewrites?: RewriteItem[],
): MatchBatch {
  return rewrites === undefined
    ? { ...match, includeRewrites }
    : { ...match, includeRewrites, rewrites };
}

export function saveReport(
  batch: MatchBatch,
  opts?: { outDir?: string; now?: Date },
): { mdPath: string; jsonPath: string } {
  if (typeof batch.includeRewrites !== "boolean") {
    throw new Error("includeRewrites required");
  }

  const problems = validateMatchResult(batch);
  if (problems.length > 0) {
    throw new Error(`validation failed: ${problems.join("; ")}`);
  }

  const { includeRewrites, rewrites: provided, ...match } = batch;
  const rewrites = includeRewrites ? (provided ?? composeRewrites(match).rewrites) : null;
  const saved: MatchBatch = rewrites ? { ...match, includeRewrites, rewrites } : { ...match, includeRewrites };
  const { markdown } = renderMatchReport(match, rewrites);

  const outRoot = opts?.outDir ?? path.join(PROJECT_ROOT, "out");
  const matchDir = path.join(outRoot, "match");
  mkdirSync(matchDir, { recursive: true });

  const stamp = stampOf((opts?.now ?? new Date()).toISOString());
  const jsonPath = path.join(matchDir, `${stamp}.json`);
  const mdPath = path.join(matchDir, `${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, markdown, "utf8");

  return { mdPath, jsonPath };
}
