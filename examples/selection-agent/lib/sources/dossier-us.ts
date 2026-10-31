import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoLandedCost, demoQuote } from "../demo-margin.ts";
import type {
  CompetitorSnapshot,
  KeywordMetrics,
  MarketSource,
  Product,
  ProductFacts,
} from "./types.ts";

type CatalogProduct = {
  asin: string;
  title: string;
  price: number;
  query: string;
  rating?: number;
  reviewCount?: number;
  image?: string;
};

type Item = CatalogProduct & { hay: string };

type KeywordRow = {
  monthlySearchVolume: number;
  trend3m?: number;
};

function matches(hay: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => hay.includes(token));
}

function loadCatalog(): Item[] {
  const file = fileURLToPath(new URL("../../data/us-search.json", import.meta.url));
  const raw = JSON.parse(readFileSync(file, "utf8")) as { products?: CatalogProduct[] };
  const items: Item[] = [];
  const known = new Set<string>();
  for (const row of raw.products ?? []) {
    const asin = row.asin?.trim().toUpperCase();
    const title = row.title?.trim();
    if (!asin || !title || !Number.isFinite(row.price) || row.price <= 0 || known.has(asin)) continue;
    known.add(asin);
    items.push({
      ...row,
      asin,
      title,
      query: row.query,
      hay: [title, row.query, asin].join(" ").toLowerCase(),
      ...(row.image?.startsWith("https://") ? { image: row.image } : {}),
    });
  }
  return items;
}

function loadKeywordSnapshot(): Map<string, KeywordRow> {
  const file = fileURLToPath(new URL("../../data/us-keyword-metrics.json", import.meta.url));
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      keywords?: Record<string, { monthlySearchVolume?: number; trend3m?: number }>;
    };
    const map = new Map<string, KeywordRow>();
    for (const [keyword, row] of Object.entries(raw.keywords ?? {})) {
      const volume = row.monthlySearchVolume;
      if (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0) continue;
      const key = keyword.trim().toLowerCase();
      if (!key) continue;
      map.set(key, {
        monthlySearchVolume: volume,
        ...(typeof row.trend3m === "number" && Number.isFinite(row.trend3m) ? { trend3m: row.trend3m } : {}),
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

const pool = loadCatalog();
const keywordSnapshot = loadKeywordSnapshot();

function find(asin: string): Item | undefined {
  return pool.find((item) => item.asin === asin.trim().toUpperCase());
}

function resolveKeywordMetrics(asin: string, item: Item): KeywordMetrics | undefined {
  const keyword = item.query.trim().toLowerCase();
  const row = keywordSnapshot.get(keyword);
  if (!row) return undefined;
  return {
    asin,
    keyword,
    monthlySearchVolume: row.monthlySearchVolume,
    ...(row.trend3m !== undefined ? { trend3m: row.trend3m } : {}),
  };
}

function cohortSnapshot(item: Item): CompetitorSnapshot | undefined {
  const peers = pool.filter((peer) => peer.query === item.query && peer.reviewCount !== undefined);
  if (!peers.length) return undefined;
  const reviews = peers.map((peer) => peer.reviewCount).filter((n): n is number => n !== undefined);
  const top = [...reviews].sort((a, b) => b - a);
  const ratings = peers.map((peer) => peer.rating).filter((n): n is number => n !== undefined);
  const avg = ratings.length ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length : 0;
  return {
    asin: item.asin,
    topSellerReviews: top,
    brandConcentration: null,
    medianListingAgeMonths: null,
    avgRating: Math.round(avg * 100) / 100,
    lowReviewShare: Math.round((top.filter((n) => n < 200).length / top.length) * 1000) / 1000,
    notes: [`「${item.query}」美国站演示池里带评论数的 ${peers.length} 条。没有上架月龄和品牌销量份额。`],
  };
}

/** 美国站演示档案。货币 USD，需求用美国曲线。 */
export const dossierUsMarketSource: MarketSource = {
  name: "dossier:US",
  isMock: false,
  async searchProducts(input) {
    const query = input.query?.trim() || input.category?.trim() || "";
    const cap = Math.min(20, Math.max(1, Math.trunc(input.limit) || 8));
    return pool
      .filter((item) => input.minPriceUsd === undefined || item.price >= input.minPriceUsd)
      .filter((item) => input.maxPriceUsd === undefined || item.price <= input.maxPriceUsd)
      .filter((item) => matches(item.hay, query))
      .slice(0, cap)
      .map(
        (item): Product => ({
          asin: item.asin,
          title: item.title,
          category: item.query,
          marketplace: "US",
          priceUsd: item.price,
          currency: "USD",
          ...(item.image ? { image: item.image } : {}),
        }),
      );
  },
  async keywordMetrics(asin) {
    const item = find(asin);
    return item ? resolveKeywordMetrics(item.asin, item) : undefined;
  },
  async competitorSnapshot(asin) {
    const item = find(asin);
    return item ? cohortSnapshot(item) : undefined;
  },
  async landedCost(asin, { priceUsd }) {
    const item = find(asin);
    if (!item || !(priceUsd > 0)) return undefined;
    const quote = demoQuote(item.asin);
    if (!quote) return undefined;
    return demoLandedCost(item.asin, priceUsd, quote);
  },
  async complianceCheck(asin) {
    if (!find(asin)) return undefined;
    return {
      asin,
      riskFlags: [],
      certifications: [],
      notes: ["美国站演示档案没有这个 ASIN 的专利或认证记录。空标记不是无风险。"],
    };
  },
  async facts(asin): Promise<ProductFacts | undefined> {
    const item = find(asin);
    if (!item) return undefined;
    return {
      asin: item.asin,
      title: item.title,
      priceUsd: item.price,
      currency: "USD",
      ...(item.rating !== undefined ? { rating: item.rating } : {}),
      ...(item.reviewCount !== undefined ? { reviewCount: item.reviewCount } : {}),
      bsrCategory: item.query,
    };
  },
};
