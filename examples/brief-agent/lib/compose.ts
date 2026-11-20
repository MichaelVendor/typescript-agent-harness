import { diffBriefRows, findPreviousBrief, renderChangesSection } from "./diff-brief.ts";
import { PROJECT_ROOT } from "./save.ts";
import type { Brief, BriefRow, Evidence, Failure, TargetSignals } from "./schema.ts";
import path from "node:path";

export type ComposeBriefInput = {
  market: "DE";
  signals: TargetSignals[];
  failures: Failure[];
  truncated: boolean;
  conclusion?: string;
  /** 显式传入上次 brief；优先于自动查找。 */
  previous?: Brief | null;
  /** 查找历史的目录；默认 PROJECT_ROOT/out/briefs。 */
  briefsDir?: string;
  /** true 时不写「### 变更」（eval 隔离用）。 */
  skipDiff?: boolean;
};

function formatPrice(priceEur: number | null): string {
  if (priceEur === null) return "缺数据";
  return `€${priceEur.toFixed(2)}`;
}

function collectGaps(signals: TargetSignals[], failures: Failure[]): string[] {
  const gaps: string[] = [];
  const seen = new Set<string>();
  const push = (g: string) => {
    if (seen.has(g)) return;
    seen.add(g);
    gaps.push(g);
  };

  for (const sig of signals) {
    if (sig.buckets.pricing.priceEur === null) {
      push(`缺价格: ${sig.id}`);
    }
    if (sig.buckets.positioning.bullets.length === 0) {
      push(`缺卖点: ${sig.id}`);
    }
    if (sig.buckets.reviews.themes.length === 0) {
      push(`缺评论摘录: ${sig.id}`);
    }
    if (sig.buckets.changes.notes.length === 0) {
      push(`无变更: ${sig.id}`);
    }
  }
  for (const f of failures) {
    push(`${f.stage}失败: ${f.id} (${f.message})`);
  }
  return gaps;
}

function rowFromSignals(sig: TargetSignals): BriefRow {
  const { pricing, positioning, reviews, changes } = sig.buckets;
  const evidence: Evidence[] = [
    ...pricing.evidence,
    ...positioning.evidence,
    ...reviews.evidence,
    ...changes.evidence,
  ];
  return {
    id: sig.id,
    title: sig.title,
    priceEur: pricing.priceEur,
    rank: null,
    bullets: [...positioning.bullets],
    reviewThemes: [...reviews.themes],
    changes: [...changes.notes],
    evidence,
  };
}

function renderMarkdown(
  brief: Omit<Brief, "markdown">,
  changeLines: string[] | null,
): string {
  const lines: string[] = [];

  lines.push("### 结论");
  lines.push(brief.conclusion);
  lines.push("");

  lines.push("### 对照表");
  lines.push("| id | 标题 | 价格 | 卖点 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of brief.rows) {
    const bullets = row.bullets.length > 0 ? row.bullets.join("；") : "缺数据";
    lines.push(
      `| ${row.id} | ${row.title} | ${formatPrice(row.priceEur)} | ${bullets} |`,
    );
  }
  if (brief.rows.length === 0) {
    lines.push("| — | — | 缺数据 | — |");
  }
  lines.push("");

  lines.push("### 差评主题");
  for (const row of brief.rows) {
    const themes = row.reviewThemes.length > 0 ? row.reviewThemes.join("、") : "缺数据";
    lines.push(`- ${row.id} ${row.title}: ${themes}`);
  }
  if (brief.rows.length === 0) {
    lines.push("- 无可用差评主题");
  }
  lines.push("");

  if (changeLines) {
    lines.push(renderChangesSection(changeLines).trimEnd());
    lines.push("");
  }

  lines.push("### 缺口");
  if (brief.gaps.length === 0) {
    lines.push("- （无）");
  } else {
    for (const g of brief.gaps) {
      lines.push(`- ${g}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function composeBrief(input: ComposeBriefInput): Brief {
  const rows = input.signals.map(rowFromSignals);
  const gaps = collectGaps(input.signals, input.failures);
  const conclusion =
    input.conclusion ??
    (rows.length > 0 ? "本批可对照观察" : "本次无可用证据");

  let changeLines: string[] | null = null;
  if (!input.skipDiff) {
    const previous =
      input.previous !== undefined
        ? input.previous
        : findPreviousBrief(
            input.briefsDir ?? path.join(PROJECT_ROOT, "out", "briefs"),
            rows.map((r) => r.id),
          );
    changeLines = diffBriefRows(previous, rows);
  }

  const base: Omit<Brief, "markdown"> = {
    market: input.market,
    conclusion,
    rows,
    gaps,
    failures: [...input.failures],
    truncated: input.truncated,
    ...(changeLines ? { changesFromPrevious: changeLines } : {}),
  };

  return { ...base, markdown: renderMarkdown(base, changeLines) };
}
