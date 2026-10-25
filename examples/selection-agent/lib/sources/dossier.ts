import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  CompetitorSnapshot,
  KeywordMetrics,
  KeywordObservation,
  MarketSource,
  Product,
  ProductFacts,
} from "./types.ts";

type RawCompetitor = {
  asin?: string;
  asin_title?: string;
  asin_price?: string | number | null;
  asin_rating?: string | number | null;
  asin_review_count?: number | null;
  asin_bs_rank?: number | null;
  asin_brand?: string | null;
  asin_launch_date?: string | null;
  asin_keywords?: string | null;
  asin_image?: string | null;
  rank_trend?: string | null;
};

type RawAd = {
  keyword_text?: string;
  search_result_count?: number | null;
  average_cpc?: string | number | null;
  observation_position?: string | null;
};

type RawFile = {
  spu?: string;
  exported_at?: string;
  proposal?: {
    proposal_name?: string;
    core_keywords?: string;
    source_snapshot?: {
      category?: { category_name?: string; category_name_en?: string };
    };
  };
  research?: { competitors?: RawCompetitor[]; ads?: RawAd[] };
};

export function monthlySearchEstimate(note: string | null | undefined): number | null {
  const matched = /月搜索量估算(\d+)/.exec(note ?? "");
  return matched ? Number(matched[1]) : null;
}

/** 上架月龄只算到月份，不把备注里的销量句子换算成趋势。 */
export function monthsOnSale(launch: string, asOf: string): number | null {
  const start = Date.parse(launch);
  const end = Date.parse(asOf);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const a = new Date(start);
  const b = new Date(end);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function num(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

function matches(hay: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => hay.includes(token));
}

type Item = {
  asin: string;
  title: string;
  price: number;
  hay: string;
  query?: string;
  rating?: number;
  reviewCount?: number;
  image?: string;
  bsr?: number;
  launch?: string;
  rankTrend?: string;
};

function load(): {
  spu: string;
  asOf: string;
  category: string;
  items: Item[];
  keywords: KeywordObservation[];
} {
  const file = fileURLToPath(new URL("../../data/DE2610221.json", import.meta.url));
  const raw = JSON.parse(readFileSync(file, "utf8")) as RawFile;
  const category = raw.proposal?.source_snapshot?.category;
  const categoryName = category?.category_name || category?.category_name_en || "未分类";
  const shared = [raw.proposal?.proposal_name, raw.proposal?.core_keywords, categoryName, category?.category_name_en]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const items: Item[] = [];
  for (const row of raw.research?.competitors ?? []) {
    const asin = row.asin?.trim().toUpperCase();
    const price = num(row.asin_price);
    const title = row.asin_title?.trim();
    if (!asin || price === undefined || !title) continue;
    const rating = num(row.asin_rating);
    const reviewCount = row.asin_review_count ?? undefined;
    const bsr = row.asin_bs_rank ?? undefined;
    const launch = row.asin_launch_date?.trim() || undefined;
    const rankTrend = row.rank_trend?.trim() || undefined;
    items.push({
      asin,
      title,
      price,
      hay: [title, row.asin_brand, row.asin_keywords, asin, shared].filter(Boolean).join(" ").toLowerCase(),
      ...(rating !== undefined ? { rating } : {}),
      ...(typeof reviewCount === "number" ? { reviewCount } : {}),
      ...(typeof bsr === "number" && bsr > 0 ? { bsr } : {}),
      ...(launch ? { launch } : {}),
      ...(rankTrend ? { rankTrend } : {}),
      ...(row.asin_image?.startsWith("https://") ? { image: row.asin_image } : {}),
    });
  }
  const keywords: KeywordObservation[] = [];
  for (const ad of raw.research?.ads ?? []) {
    const keyword = ad.keyword_text?.trim();
    if (!keyword) continue;
    keywords.push({
      keyword,
      searchResultCount: typeof ad.search_result_count === "number" ? ad.search_result_count : null,
      averageCpc: num(ad.average_cpc) ?? null,
      monthlySearchEstimate: monthlySearchEstimate(ad.observation_position),
      currency: "EUR",
    });
  }
  return {
    spu: raw.spu || "DE2610221",
    asOf: raw.exported_at || "",
    category: categoryName,
    items,
    keywords,
  };
}

type CatalogProduct = {
  asin: string;
  title: string;
  price: number;
  query: string;
  rating?: number;
  reviewCount?: number;
  image?: string;
};

function loadCatalog(knownAsins: Set<string>): { fetchedAt: string; items: Item[] } {
  const file = fileURLToPath(new URL("../../data/de-search.json", import.meta.url));
  const raw = JSON.parse(readFileSync(file, "utf8")) as { fetchedAt?: string; products?: CatalogProduct[] };
  const known = new Set(knownAsins);
  const items: Item[] = [];
  for (const row of raw.products ?? []) {
    const asin = row.asin?.trim().toUpperCase();
    const title = row.title?.trim();
    if (!asin || !title || !Number.isFinite(row.price) || row.price <= 0 || known.has(asin)) continue;
    known.add(asin);
    items.push({
      asin,
      title,
      price: row.price,
      query: row.query,
      hay: [title, row.query, asin].join(" ").toLowerCase(),
      ...(row.rating !== undefined ? { rating: row.rating } : {}),
      ...(row.reviewCount !== undefined ? { reviewCount: row.reviewCount } : {}),
      ...(row.image?.startsWith("https://") ? { image: row.image } : {}),
    });
  }
  return { fetchedAt: raw.fetchedAt || "", items };
}

const dossier = load();
const catalog = loadCatalog(new Set(dossier.items.map((item) => item.asin)));
const pool = [...dossier.items, ...catalog.items];

type KeywordRow = {
  monthlySearchVolume: number;
  trend3m?: number;
};

function loadKeywordSnapshot(): Map<string, KeywordRow> {
  const file = fileURLToPath(new URL("../../data/keyword-metrics.json", import.meta.url));
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

const keywordSnapshot = loadKeywordSnapshot();

/** 按商品类目词或标题里出现的词，从快照取需求。没有 12 个月序列就不编。 */
export function resolveKeywordMetrics(asin: string, item: Item): KeywordMetrics | undefined {
  if (item.query) {
    const keyword = item.query.trim().toLowerCase();
    const row = keywordSnapshot.get(keyword);
    if (row) {
      return {
        asin,
        keyword,
        monthlySearchVolume: row.monthlySearchVolume,
        ...(row.trend3m !== undefined ? { trend3m: row.trend3m } : {}),
      };
    }
  }
  // 档案竞品没有 query：按快照写入顺序（广告流量序）取第一个命中的词，不挑搜索量最大的泛词。
  for (const [keyword, row] of keywordSnapshot) {
    if (!item.hay.includes(keyword)) continue;
    return {
      asin,
      keyword,
      monthlySearchVolume: row.monthlySearchVolume,
      ...(row.trend3m !== undefined ? { trend3m: row.trend3m } : {}),
    };
  }
  return undefined;
}

function findDossier(asin: string): Item | undefined {
  return dossier.items.find((item) => item.asin === asin);
}

function find(asin: string): Item | undefined {
  return pool.find((item) => item.asin === asin);
}

function cohortSnapshot(item: Item): CompetitorSnapshot | undefined {
  const peers = catalog.items.filter((peer) => peer.query === item.query && peer.reviewCount !== undefined);
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
    notes: [`「${item.query}」这次搜索页上带评论数的 ${peers.length} 条，不是档案里的封闭竞品集。没有上架月龄和品牌销量份额。`],
  };
}

function snapshot(): CompetitorSnapshot | undefined {
  const reviews = dossier.items
    .map((item) => item.reviewCount)
    .filter((n): n is number => n !== undefined);
  if (!reviews.length) return undefined;
  const top = [...reviews].sort((a, b) => b - a);
  const ages = dossier.items
    .map((item) => (item.launch && dossier.asOf ? monthsOnSale(item.launch, dossier.asOf) : null))
    .filter((n): n is number => n !== null);
  const ratings = dossier.items.map((item) => item.rating).filter((n): n is number => n !== undefined);
  const avg = ratings.reduce((sum, n) => sum + n, 0) / (ratings.length || 1);
  return {
    asin: "",
    topSellerReviews: top,
    brandConcentration: null,
    medianListingAgeMonths: median(ages),
    avgRating: Math.round(avg * 100) / 100,
    lowReviewShare: Math.round((top.filter((n) => n < 200).length / top.length) * 1000) / 1000,
    closedSet: true,
    notes: dossier.items.flatMap((item) => (item.rankTrend ? [item.rankTrend] : [])),
  };
}

export const dossierMarketSource: MarketSource = {
  name: `dossier:${dossier.spu}`,
  isMock: false,
  async searchProducts(input) {
    const query = input.query?.trim() || input.category?.trim() || "";
    const cap = Math.min(20, Math.max(1, Math.trunc(input.limit) || 8));
    return pool
      .filter((item) => input.minPriceUsd === undefined || item.price >= input.minPriceUsd)
      .filter((item) => input.maxPriceUsd === undefined || item.price <= input.maxPriceUsd)
      .filter((item) => matches(item.hay, query))
      .slice(0, cap)
      .map((item): Product => ({
        asin: item.asin,
        title: item.title,
        category: item.query || dossier.category,
        marketplace: "DE",
        priceUsd: item.price,
        currency: "EUR",
        ...(item.image ? { image: item.image } : {}),
      }));
  },
  async keywordMetrics(asin) {
    const item = find(asin.trim().toUpperCase());
    return item ? resolveKeywordMetrics(item.asin, item) : undefined;
  },
  async keywordObservations(asin) {
    return findDossier(asin) ? dossier.keywords : undefined;
  },
  async competitorSnapshot(asin) {
    const fromDossier = findDossier(asin);
    if (fromDossier) {
      const base = snapshot();
      return base ? { ...base, asin: fromDossier.asin } : undefined;
    }
    const fromCatalog = catalog.items.find((item) => item.asin === asin);
    return fromCatalog ? cohortSnapshot(fromCatalog) : undefined;
  },
  async landedCost() {
    return undefined;
  },
  async complianceCheck(asin) {
    if (!find(asin)) return undefined;
    return {
      asin,
      riskFlags: [],
      certifications: [],
      notes: ["档案没有这个 ASIN 的专利或认证记录。空标记不是无风险。"],
    };
  },
  async facts(asin): Promise<ProductFacts | undefined> {
    const item = find(asin);
    if (!item) return undefined;
    return {
      asin: item.asin,
      title: item.title,
      priceUsd: item.price,
      currency: "EUR",
      ...(item.rating !== undefined ? { rating: item.rating } : {}),
      ...(item.reviewCount !== undefined ? { reviewCount: item.reviewCount } : {}),
      ...(item.bsr !== undefined ? { bsr: item.bsr } : {}),
      bsrCategory: dossier.category,
    };
  },
};
