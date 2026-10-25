/** 亚马逊德国站搜索卡片。只读标题、欧元现价、评分、评论数。读不到的不填。 */

export type DeSearchHit = {
  asin: string;
  title: string;
  price: number;
  rating?: number;
  reviewCount?: number;
  /** 搜索卡片上的主图。没有就不填。 */
  image?: string;
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

function euros(raw: string): number | undefined {
  const text = raw.replace(/&nbsp;/g, " ").replace(/\u00a0/g, " ");
  if (!text.includes("€")) return undefined;
  const matched = /([0-9.]+),([0-9]{2})/.exec(text);
  if (!matched) return undefined;
  const price = Number(matched[1]!.replace(/\./g, "")) + Number(matched[2]) / 100;
  return Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : undefined;
}

/** 同一 asin 只留第一条。没有标题或欧元价的卡片丢掉。 */
export function parseDeSearchHtml(html: string): DeSearchHit[] {
  const marks = [
    ...html.matchAll(/data-asin="(B0[A-Z0-9]{8})"[^>]{0,400}data-component-type="s-search-result"/g),
  ];
  const hits: DeSearchHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!;
    const asin = mark[1]!;
    const card = html.slice(mark.index! + mark[0].length, marks[i + 1]?.index ?? html.length);
    const title = decode(card.match(/<h2[^>]*aria-label="([^"]+)"/)?.[1] ?? "");
    const price = euros(card.match(/class="a-offscreen">([^<]+)/)?.[1] ?? "");
    if (!title || price === undefined || seen.has(asin)) continue;
    seen.add(asin);
    const rating = Number(card.match(/([0-9]+,[0-9]) von 5 Sternen/)?.[1]?.replace(",", "."));
    const reviewCount = Number(card.match(/aria-label="([0-9.]+) Bewertungen"/)?.[1]?.replace(/\./g, ""));
    const image = card.match(/<img class="s-image" src="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.jpg)"/)?.[1];
    hits.push({
      asin,
      title,
      price,
      ...(Number.isFinite(rating) ? { rating } : {}),
      ...(Number.isFinite(reviewCount) ? { reviewCount } : {}),
      ...(image ? { image } : {}),
    });
  }
  return hits;
}
