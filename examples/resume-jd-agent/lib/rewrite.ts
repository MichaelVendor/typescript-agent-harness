import type { MatchResult, RewriteItem, RewriteResult } from "./schema.ts";

// Only re-uses text from evidence + requirement; never invents new proper nouns.
export function composeRewrites(match: MatchResult): RewriteResult {
  const rewrites: RewriteItem[] = [];
  for (const row of match.rows) {
    if (row.status === "met" || row.evidence == null) continue;
    const before = row.evidence;
    rewrites.push({
      reqId: row.id,
      before,
      after: `${before}（对应要求：${row.requirement}）`,
      evidence: before,
    });
  }
  return { rewrites };
}
