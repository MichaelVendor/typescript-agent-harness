/** DE/EN 短词表：neg 优先于 pos；未命中为中性。子串匹配。 */

const NEG = [
  "rost",
  "rust",
  "schwer",
  "klein",
  "kratzt",
  "scratch",
  "geruch",
  "smell",
  "weicht",
  "abweich",
  "kaputt",
  "broken",
  "schlecht",
  "poor",
  "defect",
  "mangel",
] as const;

const POS = [
  "schön",
  "gut",
  "edel",
  "stabil",
  "leicht",
  "preis",
  "good",
  "great",
  "solid",
  "nice",
  "quality",
  "verarbeitet",
] as const;

export type ReviewPolarity = "neg" | "pos" | "neutral";

export function classifySnippet(snippet: string): ReviewPolarity {
  const lower = snippet.trim().toLowerCase();
  if (!lower) return "neutral";
  if (NEG.some((k) => lower.includes(k))) return "neg";
  if (POS.some((k) => lower.includes(k))) return "pos";
  return "neutral";
}

/** 整句主题；同极性桶内大小写无关去重，保留首次写法。 */
export function splitReviewSnippets(snippets: string[]): {
  cons: string[];
  pros: string[];
} {
  const cons: string[] = [];
  const pros: string[] = [];
  const seenCons = new Set<string>();
  const seenPros = new Set<string>();

  for (const raw of snippets) {
    const theme = raw.trim();
    if (!theme) continue;
    const key = theme.toLowerCase();
    const pol = classifySnippet(theme);
    if (pol === "neg") {
      if (seenCons.has(key)) continue;
      seenCons.add(key);
      cons.push(theme);
    } else if (pol === "pos") {
      if (seenPros.has(key)) continue;
      seenPros.add(key);
      pros.push(theme);
    }
  }
  return { cons, pros };
}
