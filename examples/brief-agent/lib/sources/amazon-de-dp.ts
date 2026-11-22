/**
 * 亚马逊德国站商品详情 `/dp` 解析：卖点 bullets、评论摘录。
 * 读不到的字段保持空数组，不编造。
 */

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SKIP_BULLET = /make sure this fits|dieses passform|siehe mehr|see more|jetzt anmelden/i;

/** 从 feature-bullets（或同类 ul）抽卖点，跳过「确认型号」等 boilerplate。 */
export function parseDeDpBullets(html: string): string[] {
  const block =
    html.match(/id="feature-bullets"[\s\S]{0,12000}?<\/div>/i)?.[0] ??
    html.match(/id="featurebullets_feature_div"[\s\S]{0,12000}?<\/div>/i)?.[0] ??
    "";
  if (!block) return [];
  const items = [...block.matchAll(/class="a-list-item"[^>]*>([\s\S]*?)<\/span>/gi)];
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const m of items) {
    const text = decode(m[1] ?? "");
    if (!text || text.length < 3 || SKIP_BULLET.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(text);
    if (bullets.length >= 8) break;
  }
  return bullets;
}

/** 从 review-body / 评论页正文抽短评，最多 5 条。 */
export function parseDeDpReviews(html: string): string[] {
  const patterns = [
    /data-hook="review-body"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi,
    /data-hook="review-collapsed"[^>]*>([\s\S]*?)<\/div>/gi,
    /class="review-text-content"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi,
    /cr-original-review-content[^>]*>([\s\S]*?)<\/span>/gi,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const text = decode(m[1] ?? "");
      if (!text || text.length < 3) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text.length > 180 ? `${text.slice(0, 177)}…` : text);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

export type DeDpEnrichment = {
  bullets: string[];
  reviewSnippets: string[];
};

export function parseDeDpHtml(html: string): DeDpEnrichment {
  return {
    bullets: parseDeDpBullets(html),
    reviewSnippets: parseDeDpReviews(html),
  };
}
