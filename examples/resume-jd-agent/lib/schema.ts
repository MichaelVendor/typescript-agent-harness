export type Priority = "must" | "nice";
export type MatchStatus = "met" | "partial" | "missing";

export type JdRequirement = {
  id: string;
  text: string;
  priority: Priority;
};

export type ParseResult = {
  resumeBullets: string[];
  jdRequirements: JdRequirement[];
};

export type MatchRow = {
  id: string;
  priority: Priority;
  requirement: string;
  status: MatchStatus;
  evidence: string | null;
};

export type MatchResult = {
  rows: MatchRow[];
  gaps: string[];
};

export type RewriteItem = {
  reqId: string;
  before: string;
  after: string;
  evidence: string;
};

export type RewriteResult = {
  rewrites: RewriteItem[];
};

export type MatchBatch = MatchResult & {
  includeRewrites: boolean;
  rewrites?: RewriteItem[];
};

const VALID_PRIORITY = new Set<Priority>(["must", "nice"]);
const VALID_STATUS = new Set<MatchStatus>(["met", "partial", "missing"]);

export function validateMatchResult(result: MatchResult): string[] {
  const problems: string[] = [];
  for (const row of result.rows) {
    if (!VALID_PRIORITY.has(row.priority)) {
      problems.push(`row ${row.id}: invalid priority "${row.priority}"`);
    }
    if (!VALID_STATUS.has(row.status)) {
      problems.push(`row ${row.id}: invalid status "${row.status}"`);
    }
    if (row.status === "missing") {
      if (row.evidence != null && String(row.evidence).trim() === "") {
        problems.push(`row ${row.id}: evidence must be null or non-empty`);
      }
      // missing + null evidence OK
    } else {
      if (!row.evidence || String(row.evidence).trim() === "") {
        problems.push(`row ${row.id}: evidence is required for ${row.status}`);
      }
    }
  }
  return problems;
}