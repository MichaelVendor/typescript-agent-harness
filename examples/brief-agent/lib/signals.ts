import type { Evidence, TargetSignals } from "./schema.ts";
import type { ProductPage } from "./fetch.ts";

function ev(claim: string, detail: string): Evidence {
  return { claim, source: "mock", detail };
}

/** 朴素：按空白拆词、大小写无关去重，保留首次出现写法。 */
function themesFromSnippets(snippets: string[]): string[] {
  const seen = new Set<string>();
  const themes: string[] = [];
  for (const snippet of snippets) {
    for (const raw of snippet.split(/\s+/)) {
      const word = raw.trim();
      if (!word) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      themes.push(word);
    }
  }
  return themes;
}

export function extractSignalsFromPage(page: ProductPage): TargetSignals {
  const detail = page.id;

  const pricingEvidence: Evidence[] = [
    page.priceEur === null ? ev("缺价格", detail) : ev(`有价 €${page.priceEur}`, detail),
  ];

  const bullets = [...page.bullets];
  const positioningEvidence: Evidence[] =
    bullets.length > 0
      ? bullets.map((b) => ev(`卖点: ${b}`, detail))
      : [ev("无卖点 bullets", detail)];

  const themes = themesFromSnippets(page.reviewSnippets);
  const reviewsEvidence: Evidence[] =
    themes.length > 0
      ? themes.map((t) => ev(`评论主题: ${t}`, detail))
      : [ev("无评论 snippets", detail)];

  const notes = [...page.changeNotes];
  const changesEvidence: Evidence[] =
    notes.length > 0
      ? notes.map((n) => ev(`变更: ${n}`, detail))
      : [ev("无变更记录", detail)];

  return {
    id: page.id,
    title: page.title,
    buckets: {
      pricing: {
        priceEur: page.priceEur,
        currency: "EUR",
        evidence: pricingEvidence,
      },
      positioning: {
        bullets,
        evidence: positioningEvidence,
      },
      reviews: {
        themes,
        evidence: reviewsEvidence,
      },
      changes: {
        notes,
        evidence: changesEvidence,
      },
    },
  };
}
