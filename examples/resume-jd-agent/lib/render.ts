import type { MatchResult, RewriteItem } from "./schema.ts";

const PRIORITY_LABEL = { must: "必须", nice: "加分" } as const;
const STATUS_LABEL = { met: "满足", partial: "部分满足", missing: "缺失" } as const;

function cell(s: string): string {
  return s.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderMatchReport(
  match: MatchResult,
  rewrites: RewriteItem[] | null,
): { markdown: string } {
  const lines: string[] = ["# 简历-JD 匹配报告", "", "## 匹配表", ""];
  lines.push("| ID | 优先级 | 要求 | 状态 | 证据 |", "| --- | --- | --- | --- | --- |");
  for (const r of match.rows) {
    lines.push(
      `| ${cell(r.id)} | ${PRIORITY_LABEL[r.priority] ?? r.priority} | ${cell(r.requirement)} | ${STATUS_LABEL[r.status] ?? r.status} | ${r.evidence ? cell(r.evidence) : "—"} |`,
    );
  }

  lines.push("", "## 缺口", "");
  if (match.gaps.length === 0) lines.push("- 无");
  else for (const g of match.gaps) lines.push(`- ${g}`);

  if (rewrites && rewrites.length > 0) {
    lines.push("", "## 改写建议", "");
    for (const w of rewrites) {
      lines.push(`### ${w.reqId}`, "", `- 原文：${w.before}`, `- 改写：${w.after}`, "");
    }
  }

  return { markdown: `${lines.join("\n").trimEnd()}\n` };
}
