import { readFileSync } from "node:fs";
import path from "node:path";
import { DEMAND_POINTS_DE } from "../tools/keyword-metrics.ts";
import { loadDemoNetMargins } from "./demo-margin.ts";
import { marketplaceProfile, sessionMarketplace, type SessionMarketplace } from "./marketplace.ts";
import { DEMAND_POINTS, marginScore, piecewise, trendScore } from "./normalize.ts";
import { scoreCandidate } from "./score.ts";

export type RecommendedProduct = { asin: string; title: string; priceEur: number };
export type RecommendedQuery = {
  query: string;
  action: "观察" | "上架";
  total: number;
  marketplace: SessionMarketplace;
  currency: "EUR" | "USD";
  siteLabel: string;
  askLabel: string;
  /** 点推荐时发出的话：带站点，方便跳过选站弹窗后仍 set_marketplace。 */
  send: string;
  products: RecommendedProduct[];
};

type CatalogProduct = {
  asin: string;
  title: string;
  price: number;
  query?: string;
  reviewCount?: number;
};

type KeywordRow = { monthlySearchVolume?: number; trend3m?: number };

const EVIDENCE = [
  { claim: "月搜索量", source: "keyword_metrics:dossier", detail: "snapshot" },
  { claim: "低评论占比", source: "competitor_snapshot:dossier", detail: "cohort" },
  { claim: "无专利记录", source: "compliance_check:dossier", detail: "empty" },
];

/** 按搜索词打分，只留下观察或上架。每个词最多 3 个已有商品。 */
export function recommendCatalog(
  products: CatalogProduct[],
  keywords: Record<string, KeywordRow>,
  netMargins: Record<string, number> = {},
  marketplace: SessionMarketplace = "DE",
): RecommendedQuery[] {
  const groups = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const query = product.query?.trim();
    if (!query) continue;
    const list = groups.get(query) ?? [];
    list.push(product);
    groups.set(query, list);
  }
  const demandPoints = marketplace === "US" ? DEMAND_POINTS : DEMAND_POINTS_DE;
  const profile = marketplaceProfile(marketplace);
  const picked: RecommendedQuery[] = [];
  for (const [query, rows] of groups) {
    const reviews = rows.map((row) => row.reviewCount).filter((n): n is number => typeof n === "number");
    if (reviews.length < 5 && marketplace === "DE") continue;
    if (reviews.length < 4 && marketplace === "US") continue;
    const lowReviewShare = reviews.filter((n) => n < 200).length / reviews.length;
    const keyword = keywords[query.toLowerCase()] ?? keywords[query];
    const volume = keyword?.monthlySearchVolume;
    const demand = typeof volume === "number" ? Number(piecewise(volume, demandPoints).toFixed(4)) : null;
    const trend = typeof keyword?.trend3m === "number" ? Number(trendScore(keyword.trend3m).toFixed(4)) : null;
    const netMargin = netMargins[query.toLowerCase()] ?? netMargins[query];
    const margin = typeof netMargin === "number" ? Number(marginScore(netMargin).toFixed(4)) : null;
    const scored = scoreCandidate({
      id: query,
      title: query,
      category: query,
      marketplace,
      priceUsd: rows[0]?.price ?? 0,
      metrics: {
        demand,
        trend,
        competition: Number(Math.min(1, Math.max(0, lowReviewShare)).toFixed(4)),
        margin,
      },
      monthlyProfitUsd: null,
      monthlyUnits: null,
      riskFlags: [],
      evidence: EVIDENCE,
    });
    if (scored.action === "放弃") continue;
    picked.push({
      query,
      action: scored.action,
      total: scored.total,
      marketplace,
      currency: profile.currency,
      siteLabel: profile.siteLabel,
      askLabel: profile.askLabel,
      send: `${profile.askLabel} ${query}`,
      products: rows.slice(0, 3).map((row) => ({ asin: row.asin, title: row.title, priceEur: row.price })),
    });
  }
  return picked.sort((a, b) => b.total - a.total || a.query.localeCompare(b.query));
}

function loadMarketRecommendations(root: string, market: SessionMarketplace): RecommendedQuery[] {
  const catalogFile = market === "US" ? "us-search.json" : "de-search.json";
  const keywordFile = market === "US" ? "us-keyword-metrics.json" : "keyword-metrics.json";
  try {
    const saved = JSON.parse(readFileSync(path.join(root, "data", catalogFile), "utf8")) as {
      products?: CatalogProduct[];
    };
    let keywords: Record<string, KeywordRow> = {};
    try {
      const raw = JSON.parse(readFileSync(path.join(root, "data", keywordFile), "utf8")) as {
        keywords?: Record<string, KeywordRow>;
      };
      keywords = raw.keywords ?? {};
    } catch {
      keywords = {};
    }
    return recommendCatalog(saved.products ?? [], keywords, loadDemoNetMargins(), market);
  } catch {
    return [];
  }
}

/**
 * 读盘推荐。已选站 → 只出该站；未选站 → 德站、美站各取靠前的，方便演示多平台。
 * 未选站时每个词只带 2 个商品，避免某一站先占满芯片位。
 */
export function recommendFromDisk(root: string): RecommendedQuery[] {
  const market = sessionMarketplace();
  if (market) return loadMarketRecommendations(root, market).slice(0, 2);
  const trim = (rows: RecommendedQuery[]) =>
    rows.slice(0, 1).map((row) => ({ ...row, products: row.products.slice(0, 2) }));
  return [...trim(loadMarketRecommendations(root, "DE")), ...trim(loadMarketRecommendations(root, "US"))];
}

export function moneySign(currency: "EUR" | "USD"): string {
  return currency === "USD" ? "$" : "€";
}
