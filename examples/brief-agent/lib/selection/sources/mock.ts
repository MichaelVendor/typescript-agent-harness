/**
 * Mock 数据源。数字是编的，但**结构是真的**：字段、单位、区间口径
 * 都按接真实 API 时的样子准备，换成 HttpMarketSource 时只替换这个文件。
 */
import {
  type CompetitorSnapshot,
  type ComplianceReport,
  type KeywordMetrics,
  type LandedCost,
  type MarketSource,
  type Product,
} from "./types.ts";

const products: Product[] = [
  { asin: "B0CAMP001", title: "露营折叠月亮椅（加厚）", category: "outdoor", marketplace: "US", priceUsd: 39.99 },
  { asin: "B0CAMP002", title: "便携气罐支架（磁吸）", category: "outdoor", marketplace: "US", priceUsd: 18.99 },
  { asin: "B0CAMP003", title: "户外国标 LED 营地灯", category: "outdoor", marketplace: "US", priceUsd: 26.5 },
  { asin: "B0PET001", title: "宠物慢食舔食垫（硅胶）", category: "pet", marketplace: "US", priceUsd: 12.99 },
  { asin: "B0PET002", title: "猫用自动饮水机（静音）", category: "pet", marketplace: "US", priceUsd: 45.0 },
  { asin: "B0PET003", title: "狗狗除毛滚刷（可重复使用）", category: "pet", marketplace: "US", priceUsd: 15.99 },
  { asin: "B0HOME001", title: "抽屉分隔收纳盒（8 件套）", category: "home", marketplace: "US", priceUsd: 21.99 },
  { asin: "B0HOME002", title: "免钉壁挂置物架（不锈钢）", category: "home", marketplace: "US", priceUsd: 29.99 },
  { asin: "B0HOME003", title: "厨房硅胶折叠沥水篮", category: "home", marketplace: "US", priceUsd: 16.99 },
  { asin: "B0ELEC001", title: "车载磁吸手机支架（MagSafe）", category: "3c", marketplace: "US", priceUsd: 24.99 },
  { asin: "B0ELEC002", title: "65W 氮化镓双口充电器", category: "3c", marketplace: "US", priceUsd: 32.99 },
  { asin: "B0ELEC003", title: "蓝牙耳机防丢挂绳（3 件装）", category: "3c", marketplace: "US", priceUsd: 9.99 },
];

const keywords: Record<string, KeywordMetrics> = {
  B0CAMP001: {
    asin: "B0CAMP001",
    keyword: "camping chair",
    monthlySearchVolume: 74000,
    monthlySeries: [38000, 41000, 52000, 68000, 81000, 96000, 104000, 99000, 78000, 61000, 47000, 44000],
    trend3m: 0.18,
    peakMonths: [6, 7, 8],
  },
  B0CAMP002: {
    asin: "B0CAMP002",
    keyword: "camping stove adapter",
    monthlySearchVolume: 12000,
    monthlySeries: [9800, 10200, 11500, 12300, 13100, 12800, 11900, 11100, 10800, 11200, 11800, 12100],
    trend3m: 0.05,
    peakMonths: [6, 7, 8],
  },
  B0CAMP003: {
    asin: "B0CAMP003",
    keyword: "camping lantern",
    monthlySearchVolume: 21000,
    monthlySeries: [15000, 16000, 21000, 27000, 31000, 33000, 32000, 29000, 21000, 17000, 14000, 13500],
    trend3m: -0.28,
    peakMonths: [5, 6, 7],
  },
  B0PET001: {
    asin: "B0PET001",
    keyword: "lick mat for dogs",
    monthlySearchVolume: 56000,
    monthlySeries: [42000, 44000, 47000, 51000, 53000, 55000, 58000, 60000, 59000, 62000, 66000, 71000],
    trend3m: 0.22,
    peakMonths: [11, 12],
  },
  B0PET002: {
    asin: "B0PET002",
    keyword: "cat water fountain",
    monthlySearchVolume: 88000,
    monthlySeries: [72000, 74000, 78000, 80000, 83000, 85000, 86000, 88000, 89000, 91000, 93000, 95000],
    trend3m: 0.09,
    peakMonths: [],
  },
  B0PET003: {
    asin: "B0PET003",
    keyword: "pet hair remover roller",
    monthlySearchVolume: 41000,
    monthlySeries: [33000, 35000, 36000, 38000, 40000, 42000, 44000, 46000, 48000, 50000, 52000, 54000],
    trend3m: 0.14,
    peakMonths: [],
  },
  B0HOME001: {
    asin: "B0HOME001",
    keyword: "drawer organizer",
    monthlySearchVolume: 92000,
    monthlySeries: [70000, 72000, 75000, 78000, 80000, 82000, 85000, 88000, 90000, 94000, 98000, 101000],
    trend3m: 0.1,
    peakMonths: [1, 9],
  },
  B0HOME002: {
    asin: "B0HOME002",
    keyword: "adhesive wall shelf",
    monthlySearchVolume: 18000,
    monthlySeries: [16000, 16500, 17000, 17800, 18200, 17900, 17600, 17400, 17100, 16900, 16800, 16700],
    trend3m: -0.02,
    peakMonths: [],
  },
  B0HOME003: {
    asin: "B0HOME003",
    keyword: "collapsible colander",
    monthlySearchVolume: 24000,
    monthlySeries: [19000, 20000, 21000, 22000, 23000, 24000, 25000, 25500, 26000, 26200, 26500, 26800],
    trend3m: 0.04,
    peakMonths: [],
  },
  B0ELEC001: {
    asin: "B0ELEC001",
    keyword: "magnetic phone mount car",
    monthlySearchVolume: 63000,
    monthlySeries: [48000, 50000, 52000, 55000, 57000, 59000, 60000, 62000, 63000, 64000, 65000, 66000],
    trend3m: 0.03,
    peakMonths: [11, 12],
  },
  B0ELEC002: {
    asin: "B0ELEC002",
    keyword: "gan charger 65w",
    monthlySearchVolume: 35000,
    monthlySeries: [22000, 24000, 26000, 29000, 31000, 33000, 35000, 36000, 37000, 38000, 39000, 40000],
    trend3m: 0.08,
    peakMonths: [11, 12],
  },
  B0ELEC003: {
    asin: "B0ELEC003",
    keyword: "airpod strap",
    monthlySearchVolume: 26000,
    monthlySeries: [30000, 29000, 28000, 27000, 26000, 25000, 24000, 23000, 22000, 21000, 20000, 19500],
    trend3m: -0.19,
    peakMonths: [9, 12],
  },
};

const competitors: Record<string, CompetitorSnapshot> = {
  B0CAMP001: {
    asin: "B0CAMP001",
    topSellerReviews: [4200, 2600, 1800, 950, 620, 380, 210, 140, 90, 60],
    brandConcentration: 0.62,
    medianListingAgeMonths: 34,
    avgRating: 4.4,
    lowReviewShare: 0.3,
  },
  B0CAMP002: {
    asin: "B0CAMP002",
    topSellerReviews: [480, 260, 190, 120, 95, 70, 55, 40, 22, 12],
    brandConcentration: 0.35,
    medianListingAgeMonths: 16,
    avgRating: 4.2,
    lowReviewShare: 0.7,
  },
  B0CAMP003: {
    asin: "B0CAMP003",
    topSellerReviews: [3100, 1900, 1200, 800, 640, 420, 300, 180, 120, 70],
    brandConcentration: 0.55,
    medianListingAgeMonths: 41,
    avgRating: 4.3,
    lowReviewShare: 0.2,
  },
  B0PET001: {
    asin: "B0PET001",
    topSellerReviews: [9800, 5400, 3100, 2200, 1600, 900, 700, 450, 260, 130],
    brandConcentration: 0.48,
    medianListingAgeMonths: 28,
    avgRating: 4.5,
    lowReviewShare: 0.3,
  },
  B0PET002: {
    asin: "B0PET002",
    topSellerReviews: [12400, 8200, 6600, 4300, 3100, 2400, 1500, 900, 400, 180],
    brandConcentration: 0.71,
    medianListingAgeMonths: 52,
    avgRating: 4.3,
    lowReviewShare: 0.1,
  },
  B0PET003: {
    asin: "B0PET003",
    topSellerReviews: [2600, 1400, 900, 620, 480, 300, 220, 160, 100, 55],
    brandConcentration: 0.4,
    medianListingAgeMonths: 22,
    avgRating: 4.1,
    lowReviewShare: 0.5,
  },
  B0HOME001: {
    asin: "B0HOME001",
    topSellerReviews: [7600, 4900, 3300, 2400, 1700, 1100, 850, 600, 380, 210],
    brandConcentration: 0.5,
    medianListingAgeMonths: 30,
    avgRating: 4.6,
    lowReviewShare: 0.2,
  },
  B0HOME002: {
    asin: "B0HOME002",
    topSellerReviews: [1800, 1100, 780, 540, 400, 260, 180, 120, 80, 40],
    brandConcentration: 0.33,
    medianListingAgeMonths: 19,
    avgRating: 4.2,
    lowReviewShare: 0.6,
  },
  B0HOME003: {
    asin: "B0HOME003",
    topSellerReviews: [3400, 2100, 1500, 1100, 800, 560, 380, 250, 160, 85],
    brandConcentration: 0.45,
    medianListingAgeMonths: 26,
    avgRating: 4.4,
    lowReviewShare: 0.4,
  },
  B0ELEC001: {
    asin: "B0ELEC001",
    topSellerReviews: [15200, 9800, 7400, 5200, 3800, 2600, 1900, 1200, 700, 320],
    brandConcentration: 0.66,
    medianListingAgeMonths: 45,
    avgRating: 4.3,
    lowReviewShare: 0.1,
  },
  B0ELEC002: {
    asin: "B0ELEC002",
    topSellerReviews: [5400, 3600, 2500, 1800, 1300, 900, 620, 400, 240, 120],
    brandConcentration: 0.58,
    medianListingAgeMonths: 24,
    avgRating: 4.4,
    lowReviewShare: 0.2,
  },
  B0ELEC003: {
    asin: "B0ELEC003",
    topSellerReviews: [2200, 1300, 860, 600, 420, 300, 190, 120, 70, 30],
    brandConcentration: 0.36,
    medianListingAgeMonths: 21,
    avgRating: 3.9,
    lowReviewShare: 0.5,
  },
};

/** 成本口径：采购价 + 头程 + FBA + 佣金，佣金按类目取 15%。 */
const costBasis: Record<string, { purchase: number; freight: number; fba: number; referral: number; moq: number }> = {
  B0CAMP001: { purchase: 7.8, freight: 4.2, fba: 6.2, referral: 0.15, moq: 500 },
  B0CAMP002: { purchase: 2.1, freight: 1.1, fba: 3.4, referral: 0.15, moq: 1000 },
  B0CAMP003: { purchase: 5.4, freight: 2.8, fba: 5.1, referral: 0.15, moq: 500 },
  B0PET001: { purchase: 1.6, freight: 0.9, fba: 3.2, referral: 0.15, moq: 2000 },
  B0PET002: { purchase: 11.5, freight: 5.6, fba: 7.8, referral: 0.15, moq: 300 },
  B0PET003: { purchase: 1.2, freight: 0.8, fba: 3.1, referral: 0.15, moq: 2000 },
  B0HOME001: { purchase: 3.4, freight: 2.1, fba: 4.6, referral: 0.15, moq: 1000 },
  B0HOME002: { purchase: 6.2, freight: 3.4, fba: 5.4, referral: 0.15, moq: 500 },
  B0HOME003: { purchase: 2.0, freight: 1.2, fba: 3.6, referral: 0.15, moq: 1000 },
  B0ELEC001: { purchase: 4.1, freight: 1.9, fba: 4.2, referral: 0.15, moq: 1000 },
  B0ELEC002: { purchase: 8.6, freight: 2.4, fba: 4.4, referral: 0.15, moq: 500 },
  B0ELEC003: { purchase: 0.5, freight: 0.3, fba: 2.9, referral: 0.15, moq: 3000 },
};

const compliance: Record<string, ComplianceReport> = {
  B0CAMP001: { asin: "B0CAMP001", riskFlags: [], certifications: ["无强制认证（非电子）"], notes: ["结构强度需过 300lb 承重测试"] },
  B0CAMP002: {
    asin: "B0CAMP002",
    riskFlags: ["危险品"],
    certifications: ["需随附警告标签"],
    notes: ["与燃气罐配合使用，亚马逊可能要求 SDS/运输合规文件"],
  },
  B0CAMP003: {
    asin: "B0CAMP003",
    riskFlags: ["认证缺失"],
    certifications: ["FCC", "UL 或 ETL"],
    notes: ["带电池/充电口，未取得 ETL 前不得上架 US"],
  },
  B0PET001: {
    asin: "B0PET001",
    riskFlags: ["食品接触"],
    certifications: ["FDA 食品级硅胶"],
    notes: ["与犬只口腔直接接触，需 FDA 级材料声明"],
  },
  B0PET002: {
    asin: "B0PET002",
    riskFlags: [],
    certifications: ["FCC", "ETL"],
    notes: ["水泵电气安全，已有 TÜV 报告的方案可复用"],
  },
  B0PET003: { asin: "B0PET003", riskFlags: [], certifications: [], notes: ["无强制认证"] },
  B0HOME001: { asin: "B0HOME001", riskFlags: [], certifications: [], notes: ["注意外观专利：常见八格结构已被广泛使用"] },
  B0HOME002: {
    asin: "B0HOME002",
    riskFlags: ["侵权"],
    certifications: [],
    notes: ["免钉胶结构存在活跃实用新型专利（US 区域），建议先做 FTO"],
  },
  B0HOME003: {
    asin: "B0HOME003",
    riskFlags: ["食品接触"],
    certifications: ["FDA 食品级硅胶"],
    notes: ["接触果蔬，需食品级材料证明"],
  },
  B0ELEC001: {
    asin: "B0ELEC001",
    riskFlags: ["侵权"],
    certifications: ["MFi（若标注 MagSafe）"],
    notes: ["MagSafe 标识需 MFi 授权，商标使用风险高"],
  },
  B0ELEC002: {
    asin: "B0ELEC002",
    riskFlags: ["认证缺失"],
    certifications: ["UL/ETL", "DOE VI 能效", "FCC"],
    notes: ["充电器类目美国站强制要求 UL/ETL 认证编号"],
  },
  B0ELEC003: {
    asin: "B0ELEC003",
    riskFlags: ["侵权"],
    certifications: [],
    notes: ["AirPods 名称与外观为 Apple 商标，标题避免使用品牌词"],
  },
};

export const mockMarketSource: MarketSource = {
  name: "mock:local-json",
  isMock: true,

  async searchProducts({ category, minPriceUsd, maxPriceUsd, limit }) {
    return products
      .filter((p) => (category ? p.category === category : true))
      .filter((p) => (minPriceUsd !== undefined ? p.priceUsd >= minPriceUsd : true))
      .filter((p) => (maxPriceUsd !== undefined ? p.priceUsd <= maxPriceUsd : true))
      .slice(0, Math.max(0, Math.min(limit, 50)));
  },

  async keywordMetrics(asin) {
    return keywords[asin];
  },

  async competitorSnapshot(asin) {
    return competitors[asin];
  },

  async landedCost(asin, { priceUsd }) {
    const basis = costBasis[asin];
    if (!basis) return undefined;
    const referralFee = priceUsd * basis.referral;
    const netProfit = priceUsd - basis.purchase - basis.freight - basis.fba - referralFee;
    return {
      asin,
      purchasePriceUsd: basis.purchase,
      freightPerUnitUsd: basis.freight,
      fbaFeeUsd: basis.fba,
      referralRate: basis.referral,
      netProfitUsd: Math.round(netProfit * 100) / 100,
      netMargin: Math.round((netProfit / priceUsd) * 1000) / 1000,
      moq: basis.moq,
      firstOrderCapitalUsd: Math.round((basis.purchase + basis.freight) * basis.moq),
    };
  },

  async complianceCheck(asin) {
    return compliance[asin];
  },
};
