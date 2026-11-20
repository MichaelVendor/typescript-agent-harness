import type { Evidence, TargetSignals } from "./schema.ts";
import type { ProductPage } from "./fetch.ts";
import { splitReviewSnippets } from "./review-polarity.ts";

function ev(claim: string, detail: string): Evidence {
  return { claim, source: "mock", detail };
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

  const { cons, pros } = splitReviewSnippets(page.reviewSnippets);
  const reviewsEvidence: Evidence[] = [];
  if (cons.length === 0 && pros.length === 0) {
    reviewsEvidence.push(ev("无评论 snippets", detail));
  } else {
    for (const t of cons) reviewsEvidence.push(ev(`差评主题: ${t}`, detail));
    for (const t of pros) reviewsEvidence.push(ev(`好评要点: ${t}`, detail));
  }

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
        themes: cons,
        pros,
        evidence: reviewsEvidence,
      },
      changes: {
        notes,
        evidence: changesEvidence,
      },
    },
  };
}
