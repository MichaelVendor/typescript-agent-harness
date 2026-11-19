export const MAX_TARGETS = 8;

export type Evidence = { claim: string; source: string; detail: string };

export type SignalBucket = {
  pricing: { priceEur: number | null; currency: "EUR"; evidence: Evidence[] };
  positioning: { bullets: string[]; evidence: Evidence[] };
  reviews: { themes: string[]; evidence: Evidence[] };
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
  reviewThemes: string[];
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
};

export type Problem = { path: string; message: string };

const EURO_PRICE = /€\s*\d|\d+[.,]\d{2}\s*€/;

export function validateBrief(brief: Brief): Problem[] {
  const problems: Problem[] = [];
  for (const row of brief.rows) {
    if (row.evidence.length < 3) {
      problems.push({ path: `rows.${row.id}.evidence`, message: "每竞品至少 3 条 evidence" });
    }
    if (row.priceEur === null && EURO_PRICE.test(brief.markdown)) {
      problems.push({ path: "markdown", message: "缺价格时禁止臆造欧元价" });
    }
    if (row.rank === null && /第\s*\d+\s*名|\bBSR\b|\b#\d+/i.test(brief.markdown) && brief.markdown.includes(row.id)) {
      problems.push({ path: "markdown", message: "无排名时禁止出现具体名次" });
    }
  }
  return problems;
}