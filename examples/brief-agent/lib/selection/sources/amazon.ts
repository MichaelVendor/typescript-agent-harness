/**
 * 亚马逊美国站公开页面。
 *
 * 搜索页给 asin、标题、现价、评分、评论数。商品页再给 Best Sellers Rank 和重量。
 * 月搜索量、近 3 个月搜索序列、采购价、头程、FBA、专利检索，这些页面上没有，
 * 对应方法返回 undefined，调用方必须标缺数据，不能用评论数或排名去换算。
 */
import type {
  CompetitorSnapshot,
  ComplianceReport,
  MarketSource,
  Product,
  ProductFacts,
} from "./types.ts";
import { parseProductHtml, parseSearchHtml, type SearchHit } from "./amazon-html.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const COOKIE = 'i18n-prefs=USD; lc-main=en_US; sp-cdn="L5Z9:US"';

const CATEGORY_QUERY: Record<string, string> = {
  pet: "pet supplies",
  outdoor: "camping gear",
  home: "home organization",
  "3c": "phone accessories",
};

/** 标题里出现这些品牌词时记「侵权」线索。这不是检索结论，只是页面上看得见的词。 */
const BRAND_FLAGS: [RegExp, string][] = [
  [/\b(magsafe|airpods)\b/i, "标题含 Apple 品牌词"],
  [/\b(disney|nike|lego|pokemon)\b/i, "标题含他人商标词"],
];

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      cookie: COOKIE,
    },
  });
  const html = await res.text();
  if (!res.ok || html.includes("api-services-support@amazon.com")) {
    throw new Error(`Amazon 拒绝了这次访问（HTTP ${res.status}）`);
  }
  return html;
}

function searchUrl(query: string, minPriceUsd?: number, maxPriceUsd?: number): string {
  const params = new URLSearchParams({ k: query });
  if (minPriceUsd !== undefined || maxPriceUsd !== undefined) {
    const low = Math.max(0, Math.round((minPriceUsd ?? 0) * 100));
    const high = Math.round((maxPriceUsd ?? 100_000) * 100);
    params.set("rh", `p_36:${low}-${high}`);
  }
  return `https://www.amazon.com/s?${params.toString()}`;
}

function inBand(price: number, minPriceUsd?: number, maxPriceUsd?: number): boolean {
  if (minPriceUsd !== undefined && price < minPriceUsd) return false;
  if (maxPriceUsd !== undefined && price > maxPriceUsd) return false;
  return true;
}

function toProduct(hit: SearchHit, category: string): Product {
  return {
    asin: hit.asin,
    title: hit.title,
    category,
    marketplace: "US",
    priceUsd: hit.priceUsd,
  };
}

export function createAmazonSource(): MarketSource {
  const hits = new Map<string, SearchHit>();
  const pages = new Map<string, ProductFacts>();

  async function loadSearch(query: string, minPriceUsd?: number, maxPriceUsd?: number): Promise<SearchHit[]> {
    const html = await fetchHtml(searchUrl(query, minPriceUsd, maxPriceUsd));
    return parseSearchHtml(html).filter((hit) => inBand(hit.priceUsd, minPriceUsd, maxPriceUsd));
  }

  const source: MarketSource = {
    name: "amazon:us",
    isMock: false,

    async searchProducts({ category, query, minPriceUsd, maxPriceUsd, limit }) {
      const q = query?.trim() || (category ? (CATEGORY_QUERY[category] ?? category) : "");
      if (!q) return [];
      const found = await loadSearch(q, minPriceUsd, maxPriceUsd);
      const capped = found.slice(0, Math.max(0, Math.min(limit, 20)));
      for (const hit of capped) hits.set(hit.asin, hit);
      return capped.map((hit) => toProduct(hit, category || q));
    },

    async keywordMetrics() {
      return undefined;
    },

    async competitorSnapshot(asin, options) {
      const title = options?.title?.trim() || hits.get(asin)?.title;
      if (!title) return undefined;
      // 用标题前几个词搜同类，不用 asin，也不用候选池自己当 Top10。
      const query = title.split(/\s+/).slice(0, 5).join(" ");
      const group = (await loadSearch(query)).slice(0, 10);
      const reviews = group.map((hit) => hit.reviewCount).filter((n): n is number => n !== undefined);
      if (reviews.length === 0) return undefined;
      const top = [...reviews].sort((a, b) => b - a).slice(0, 10);
      const ratings = group.map((hit) => hit.rating).filter((n): n is number => n !== undefined);
      const avg = ratings.reduce((sum, n) => sum + n, 0) / (ratings.length || 1);
      const snapshot: CompetitorSnapshot = {
        asin,
        topSellerReviews: top,
        brandConcentration: null,
        medianListingAgeMonths: null,
        avgRating: Math.round(avg * 100) / 100,
        lowReviewShare: Math.round((top.filter((n) => n < 200).length / top.length) * 1000) / 1000,
      };
      return snapshot;
    },

    async landedCost() {
      return undefined;
    },

    async complianceCheck(asin) {
      const title = hits.get(asin)?.title ?? (await source.facts?.(asin))?.title ?? "";
      const notes: string[] = [];
      const riskFlags: string[] = [];
      for (const [pattern, note] of BRAND_FLAGS) {
        if (pattern.test(title)) {
          riskFlags.push("侵权");
          notes.push(note);
        }
      }
      if (/\b(lithium|power bank)\b/i.test(title)) {
        riskFlags.push("危险品");
        notes.push("标题含锂电池或充电宝");
      }
      if (/\b(baby|infant|toddler)\b/i.test(title)) {
        riskFlags.push("儿童用品");
        notes.push("标题指向婴幼儿用品");
      }
      notes.push("未做专利和认证检索。风险标记为空只说明标题里没看到这些词，不是无风险。");
      const report: ComplianceReport = {
        asin,
        riskFlags,
        certifications: [],
        notes,
      };
      return report;
    },

    async facts(asin) {
      const cached = pages.get(asin);
      if (cached) return cached;
      const html = await fetchHtml(`https://www.amazon.com/dp/${encodeURIComponent(asin)}`);
      const facts = parseProductHtml(html, asin);
      const listed = hits.get(asin);
      if (facts.priceUsd === undefined && listed) facts.priceUsd = listed.priceUsd;
      if (facts.title === undefined && listed) facts.title = listed.title;
      if (facts.rating === undefined && listed?.rating !== undefined) facts.rating = listed.rating;
      if (facts.reviewCount === undefined && listed?.reviewCount !== undefined) {
        facts.reviewCount = listed.reviewCount;
      }
      pages.set(asin, facts);
      return facts;
    },
  };

  return source;
}

export const amazonMarketSource = createAmazonSource();
