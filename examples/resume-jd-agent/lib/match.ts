import type { MatchResult, MatchRow, MatchStatus, ParseResult } from "./schema.ts";

// Longest first so "精通" is stripped before shorter overlaps.
const STOPWORDS = ["相关经验", "经验", "精通", "熟悉", "相关", "有", "或", "与", "和", "及", "的", "过"];

function keywords(requirement: string): string[] {
  let s = requirement;
  for (const w of STOPWORDS) s = s.split(w).join(" ");
  const tokens = s.match(/[A-Za-z][A-Za-z0-9.+#-]*|[\u4e00-\u9fff]+/g) ?? [];
  return [...new Set(tokens)];
}

function hits(token: string, bullet: string): boolean {
  if (/^[A-Za-z]/.test(token)) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "i").test(bullet);
  }
  return bullet.includes(token);
}

export function matchRequirements(parsed: ParseResult): MatchResult {
  const rows: MatchRow[] = [];
  const gaps: string[] = [];

  for (const req of parsed.jdRequirements) {
    const tokens = keywords(req.text);
    let best: { bullet: string; count: number } | null = null;
    for (const bullet of parsed.resumeBullets) {
      const count = tokens.filter((t) => hits(t, bullet)).length;
      if (count > 0 && (!best || count > best.count)) best = { bullet, count };
    }

    let status: MatchStatus;
    if (!best) status = "missing";
    else status = best.count === tokens.length ? "met" : "partial";

    if (status === "missing") gaps.push(`未覆盖：${req.text}`);
    rows.push({
      id: req.id,
      priority: req.priority,
      requirement: req.text,
      status,
      evidence: best ? best.bullet : null,
    });
  }

  return { rows, gaps };
}
