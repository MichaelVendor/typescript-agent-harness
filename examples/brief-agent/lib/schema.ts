export const MAX_TARGETS = 8;

export type Evidence = { claim: string; source: string; detail: string };

export type SignalBucket = {
  pricing: { priceEur: number | null; currency: "EUR"; evidence: Evidence[] };
  positioning: { bullets: string[]; evidence: Evidence[] };
  reviews: { themes: string[]; pros: string[]; evidence: Evidence[] };
  changes: { notes: string[]; evidence: Evidence[] };
};

export type TargetSignals = {
  id: string;
  title: string;
  buckets: SignalBucket;
};

export type BriefRow = {
  id: string;
  title: string;
  priceEur: number | null;
  rank: number | null;
  bullets: string[];
  /** 差评/风险向主题（清洗后）。 */
  reviewThemes: string[];
  /** 好评要点；旧 brief 可缺。 */
  reviewPros?: string[];
  changes: string[];
  evidence: Evidence[];
};

export type Failure = { id: string; stage: string; message: string };

export type Brief = {
  market: "DE";
  conclusion: string;
  rows: BriefRow[];
  gaps: string[];
  failures: Failure[];
  truncated: boolean;
  markdown: string;
  /** ops=细表；exec=老板一页纸。缺省按 ops。 */
  template?: "ops" | "exec";
  /** 相对上次同 id 集合简报的变更行（不含「### 变更」标题）。 */
  changesFromPrevious?: string[];
};

export type Problem = { path: string; message: string };

const EURO_PRICE = /€\s*\d|\d+[.,]\d{2}\s*€/;
/** `#3` after `|` has no word boundary before `#`, so avoid `\b#\d+`. */
const RANK_TEXT = /第\s*\d+\s*名|\bBSR\b|#\d+/i;

/** Lines that mention any of `needles` — priced peers don't false-flag null-price rows. */
function markdownScope(markdown: string, ...needles: string[]): string {
  return markdown
    .split("\n")
    .filter((line) => needles.some((n) => n.length > 0 && line.includes(n)))
    .join("\n");
}

export function validateBrief(brief: Brief): Problem[] {
  const problems: Problem[] = [];
  const markdownProblemKeys = new Set<string>();
  for (const row of brief.rows) {
    if (row.evidence.length < 3) {
      problems.push({ path: `rows.${row.id}.evidence`, message: "每竞品至少 3 条 evidence" });
    }
    const scope = markdownScope(brief.markdown, row.id, row.title);
    if (row.priceEur === null && EURO_PRICE.test(scope)) {
      const key = "markdown:缺价格时禁止臆造欧元价";
      if (!markdownProblemKeys.has(key)) {
        markdownProblemKeys.add(key);
        problems.push({ path: "markdown", message: "缺价格时禁止臆造欧元价" });
      }
    }
    if (row.rank === null && RANK_TEXT.test(scope)) {
      const key = "markdown:无排名时禁止出现具体名次";
      if (!markdownProblemKeys.has(key)) {
        markdownProblemKeys.add(key);
        problems.push({ path: "markdown", message: "无排名时禁止出现具体名次" });
      }
    }
  }
  return problems;
}