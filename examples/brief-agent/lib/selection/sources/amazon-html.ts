import type { ProductFacts } from "./types.ts";

/** 搜索结果卡片里能直接读到的字段。 */
export type SearchHit = {
  asin: string;
  title: string;
  priceUsd: number;
  rating?: number;
  reviewCount?: number;
};

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从亚马逊搜索页 HTML 抽出商品。同一 asin 只留第一条。没有标题或现价的卡片丢掉。 */
export function parseSearchHtml(html: string): SearchHit[] {
  const cards = html.split('data-component-type="s-search-result"').slice(1);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const card of cards) {
    const asin = card.match(/data-asin="(B0[A-Z0-9]{8})"/)?.[1];
    const title = decode(card.match(/<h2[^>]*aria-label="([^"]+)"/)?.[1] ?? "");
    const priceRaw = card.match(/class="a-offscreen">\$([0-9,]+\.[0-9]{2})/)?.[1];
    if (!asin || !title || !priceRaw || seen.has(asin)) continue;
    const priceUsd = Number(priceRaw.replace(/,/g, ""));
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    seen.add(asin);
    const rating = Number(card.match(/([0-9.]+) out of 5 stars/)?.[1]);
    const reviewCount = Number((card.match(/aria-label="([0-9,]+) ratings"/)?.[1] ?? "").replace(/,/g, ""));
    hits.push({
      asin,
      title,
      priceUsd,
      ...(Number.isFinite(rating) ? { rating } : {}),
      ...(Number.isFinite(reviewCount) ? { reviewCount } : {}),
    });
  }
  return hits;
}

/** 从商品页 HTML 抽出排名和重量。读不到的字段不填。 */
export function parseProductHtml(html: string, asin: string): ProductFacts {
  const facts: ProductFacts = { asin };
  const title = html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1];
  if (title) facts.title = decode(title);
  const priceRaw = html.match(/class="a-offscreen">\$([0-9,]+\.[0-9]{2})/)?.[1];
  if (priceRaw) facts.priceUsd = Number(priceRaw.replace(/,/g, ""));
  const rating = Number(html.match(/([0-9.]+) out of 5 stars/)?.[1]);
  if (Number.isFinite(rating)) facts.rating = rating;
  const reviewCount = Number((html.match(/([0-9,]+) ratings/)?.[1] ?? "").replace(/,/g, ""));
  if (Number.isFinite(reviewCount)) facts.reviewCount = reviewCount;
  const bsr = html.match(/#([0-9,]+) in ([^<(]{2,80})/);
  if (bsr) {
    facts.bsr = Number(bsr[1]!.replace(/,/g, ""));
    facts.bsrCategory = decode(bsr[2] ?? "");
  }
  const weight = html.match(/Item Weight<\/span>[\s\S]{0,240}?([0-9.]+) pounds/);
  if (weight) facts.weightLb = Number(weight[1]);
  return facts;
}
