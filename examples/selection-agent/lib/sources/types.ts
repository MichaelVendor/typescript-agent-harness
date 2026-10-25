/**
 * 数据源适配层。
 *
 * 第一版全部是 mock / 本地 JSON，但接口从第一天就定死：之后接卖家精灵、
 * Helium 10、Jungle Scout 或平台官方 API 时，只换 implementation，工具和打分模型不动。
 * 每个方法都显式带 `source` 字段，让模型知道"这条证据是谁说的"。
 */

export type Marketplace = "US" | "UK" | "DE" | "JP";

export type Product = {
  asin: string;
  title: string;
  category: string;
  marketplace: Marketplace;
  /** 货架价的数字。美元档案是 USD，德国档案是 EUR，看 currency。 */
  priceUsd: number;
  currency?: "USD" | "EUR";
  /** 搜索页或档案里的主图。没有就不填。 */
  image?: string;
};

export type KeywordMetrics = {
  asin: string;
  keyword: string;
  monthlySearchVolume: number;
  /** 每月搜索量，最近 12 个月，最后一个是最新的。 */
  monthlySeries: number[];
  /** 近 3 个月相对前 3 个月的变化率，-1..1+。 */
  trend3m: number;
  peakMonths: number[];
};

export type CompetitorSnapshot = {
  asin: string;
  topSellerReviews: number[];
  /** 头部 3 个品牌占 Top10 的销量份额，0–1。搜索页没有销量份额时为 null。 */
  brandConcentration: number | null;
  /** Top10 的中位上架月龄。页面上没有时为 null。 */
  medianListingAgeMonths: number | null;
  avgRating: number;
  /** Top10 中评论数少于 200 的条数占比，0–1。 */
  lowReviewShare: number;
  /** 档案里的竞品已经列全，条数可以少于 5。搜索页抽样不要设。 */
  closedSet?: boolean;
  notes?: string[];
};

/** 商品页上能直接读到的数。没有的字段不填，不估算。 */
export type ProductFacts = {
  asin: string;
  title?: string;
  priceUsd?: number;
  rating?: number;
  reviewCount?: number;
  /** Best Sellers Rank，类目内名次，越小越靠前。 */
  bsr?: number;
  bsrCategory?: string;
  weightLb?: number;
  currency?: "USD" | "EUR";
};

/** 关键词档案里的原始列。月搜索量只在备注里出现时放到 monthlySearchEstimate，不拿去打分。 */
export type KeywordObservation = {
  keyword: string;
  searchResultCount: number | null;
  averageCpc: number | null;
  monthlySearchEstimate: number | null;
  currency: "EUR" | "USD";
};

export type LandedCost = {
  asin: string;
  purchasePriceUsd: number;
  freightPerUnitUsd: number;
  fbaFeeUsd: number;
  referralRate: number;
  /** 扣除全部成本后的单件净利，USD。 */
  netProfitUsd: number;
  /** 净利率 = netProfit / price。 */
  netMargin: number;
  /** 起订量与首单资金需求。 */
  moq: number;
  firstOrderCapitalUsd: number;
};

export type ComplianceReport = {
  asin: string;
  riskFlags: string[];
  certifications: string[];
  notes: string[];
};

export interface MarketSource {
  /** 人类可读的源名，写进 evidence.source。 */
  readonly name: string;
  readonly isMock: boolean;
  searchProducts(input: {
    category?: string;
    /** 搜索词。有它时优先于 category。 */
    query?: string;
    minPriceUsd?: number;
    maxPriceUsd?: number;
    limit: number;
  }): Promise<Product[]>;
  keywordMetrics(asin: string): Promise<KeywordMetrics | undefined>;
  keywordObservations?(asin: string): Promise<KeywordObservation[] | undefined>;
  competitorSnapshot(asin: string, options?: { title?: string }): Promise<CompetitorSnapshot | undefined>;
  landedCost(asin: string, options: { priceUsd: number }): Promise<LandedCost | undefined>;
  complianceCheck(asin: string): Promise<ComplianceReport | undefined>;
  /** 商品页上的原始字段。mock 源没有这一步。 */
  facts?(asin: string): Promise<ProductFacts | undefined>;
}
