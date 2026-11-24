import type { ExtractResult, ItemSection, ReportItem, ReportTemplate } from "./schema.ts";

const OPS_SECTIONS: { key: ItemSection; title: string }[] = [
  { key: "done", title: "完成" },
  { key: "wip", title: "进行中" },
  { key: "risk", title: "风险" },
  { key: "next", title: "下周" },
];

const SUMMARY_PER_SECTION = 2;
const SUMMARY_MAX = 5;

export function isReportTemplate(value: unknown): value is ReportTemplate {
  return value === "ops" || value === "exec";
}

function bullets(items: ReportItem[]): string[] {
  return items.length === 0 ? ["（无）"] : items.map((i) => `- ${i.text}`);
}

function bySection(result: ExtractResult, key: ItemSection): ReportItem[] {
  return result.items.filter((i) => i.section === key);
}

function gapsAppendix(result: ExtractResult): string[] {
  const lines = ["## 缺口", ""];
  const unclassified = bySection(result, "unclassified");
  if (result.gaps.length === 0 && unclassified.length === 0) {
    lines.push("（无）");
    return lines;
  }
  for (const gap of result.gaps) lines.push(`- ${gap}`);
  for (const item of unclassified) lines.push(`- 未归类 ${item.id}：${item.text}`);
  return lines;
}

function header(result: ExtractResult, title: string): string[] {
  return [`# ${title}`, "", `周期：${result.periodHint ?? "待确认"}`, ""];
}

function renderOps(result: ExtractResult): string {
  const lines = header(result, "周报（运营版）");
  for (const { key, title } of OPS_SECTIONS) {
    lines.push(`## ${title}`, "", ...bullets(bySection(result, key)), "");
  }
  lines.push(...gapsAppendix(result), "");
  return lines.join("\n");
}

const EXEC_SUMMARY_SECTIONS = ["done", "wip", "risk"] as const;

function execSummaryItems(result: ExtractResult): ReportItem[] {
  const buckets = EXEC_SUMMARY_SECTIONS.map((key) => bySection(result, key));
  const summary: ReportItem[] = [];
  for (let round = 0; round < SUMMARY_PER_SECTION && summary.length < SUMMARY_MAX; round++) {
    for (let s = 0; s < EXEC_SUMMARY_SECTIONS.length && summary.length < SUMMARY_MAX; s++) {
      const item = buckets[s]![round];
      if (item) summary.push(item);
    }
  }
  return summary;
}

function renderExec(result: ExtractResult): string {
  const summary = execSummaryItems(result);
  const lines = header(result, "周报（管理层一页）");
  lines.push("## 摘要", "", ...bullets(summary), "");
  lines.push("## 下周", "", ...bullets(bySection(result, "next")), "");
  lines.push(...gapsAppendix(result), "");
  return lines.join("\n");
}

export function renderReport(
  result: ExtractResult,
  template: ReportTemplate,
): { markdown: string; template: ReportTemplate } {
  if (!isReportTemplate(template)) throw new Error("template required");
  const markdown = template === "ops" ? renderOps(result) : renderExec(result);
  return { markdown, template };
}
