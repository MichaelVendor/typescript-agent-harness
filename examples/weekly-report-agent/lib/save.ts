import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isReportTemplate, renderReport } from "./render.ts";
import { validateExtractResult } from "./schema.ts";
import type { ExtractResult, ReportBatch, ReportTemplate } from "./schema.ts";

export const PROJECT_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

function stampOf(iso: string): string {
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}

export function selectTemplate(
  result: ExtractResult,
  template: ReportTemplate,
): ReportBatch {
  return { ...result, template };
}

export function saveReport(
  batch: ReportBatch,
  opts?: { outDir?: string; now?: Date },
): { mdPath: string; jsonPath: string } {
  if (!isReportTemplate(batch.template)) {
    throw new Error("template required");
  }

  const problems = validateExtractResult(batch);
  if (problems.length > 0) {
    throw new Error(`validation failed: ${problems.join("; ")}`);
  }

  const { markdown } = renderReport(batch, batch.template);

  const outRoot = opts?.outDir ?? path.join(PROJECT_ROOT, "out");
  const reportsDir = path.join(outRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const stamp = stampOf((opts?.now ?? new Date()).toISOString());
  const jsonPath = path.join(reportsDir, `${stamp}.json`);
  const mdPath = path.join(reportsDir, `${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, markdown, "utf8");

  return { mdPath, jsonPath };
}
