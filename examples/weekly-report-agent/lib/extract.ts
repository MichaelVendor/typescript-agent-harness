import type { ExtractResult, ItemSection, ReportItem } from "./schema.ts";

const PERIOD_RE = /（([^）]*)）|\(([^)]*)\)/;
const LABEL_RE = /^(完成|已上线|风险|阻塞|下周|next|wip|done)\s*[:：]\s*/i;

function classify(line: string): ItemSection {
  if (/下周|next/i.test(line)) return "next";
  if (/风险|阻塞|催/.test(line)) return "risk";
  if (/完成|已上线|done/i.test(line)) return "done";
  if (/还在|进行中|wip|改/i.test(line)) return "wip";
  return "unclassified";
}

export function extractItems(text: string): ExtractResult {
  const items: ReportItem[] = [];
  const gaps: string[] = [];
  let periodHint: string | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const evidence = raw.trim();
    if (evidence === "") continue;

    // 标题行（本周杂记（…））：提取 periodHint，无可归类关键词则跳过
    if (/^本周杂记/.test(evidence) && classify(evidence) === "unclassified") {
      const m = evidence.match(PERIOD_RE);
      periodHint = (m?.[1] ?? m?.[2] ?? evidence).trim();
      continue;
    }

    const section = classify(evidence);
    const body = evidence.replace(/^[-*•]\s*/, "").replace(LABEL_RE, "").trim();
    const id = `i${items.length + 1}`;
    items.push({ id, section, text: body, evidence });
    if (section === "unclassified") {
      gaps.push(`${id} 无法归类：${body}`);
    }
  }

  const out: ExtractResult = { items, gaps };
  if (periodHint !== undefined) out.periodHint = periodHint;
  return out;
}
