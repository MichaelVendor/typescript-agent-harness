import { defineTool } from "@typescript-agent-harness/cli";
import { activeMarketSource } from "../lib/sources/index.ts";
import { DEMAND_POINTS, piecewise, seasonalityRatio, trendScore } from "../lib/normalize.ts";

/** 德国站卖家精灵快照的月搜索量在 1.5k–10k。1k≈0.2，4k≈0.5，12k≈0.8，20k+≈0.95。 */
export const DEMAND_POINTS_DE: [number, number][] = [
  [0, 0],
  [1_000, 0.2],
  [4_000, 0.5],
  [12_000, 0.8],
  [20_000, 0.95],
];

/**
 * 需求与趋势：回答"有人搜吗、在涨还是在跌、是不是只有旺季能卖"。
 * 德国站档案的 demand 在这个工具里按 DEMAND_POINTS_DE 算好。子 Agent 只抄 scores，不要再换算。
 * 快照有月搜索量就可以算 demand；没有 12 个月序列时 trend 仍为 null。
 */
export default defineTool({
  description:
    "查某商品的需求与趋势。有月搜索量时给出 demand；有环比或 12 个月序列时才给 trend。亚马逊页面没有这些数时分数写 null，不要把评论数换算成需求。",
  inputSchema: {
    type: "object",
    properties: { asin: { type: "string", description: "商品 asin，例如 B0CAMP001" } },
    required: ["asin"],
    additionalProperties: false,
  },
  async execute(input: { asin: string }) {
    const source = activeMarketSource();
    const asin = input.asin.trim().toUpperCase();
    const metrics = await source.keywordMetrics(asin);
    if (!metrics) {
      const facts = await source.facts?.(asin);
      const keywords = await source.keywordObservations?.(asin);
      return {
        asin,
        source: source.name,
        isMock: source.isMock,
        observed: facts
          ? {
              reviewCount: facts.reviewCount ?? null,
              rating: facts.rating ?? null,
              bsr: facts.bsr ?? null,
              bsrCategory: facts.bsrCategory ?? null,
              currency: facts.currency ?? null,
            }
          : null,
        keywords: keywords ?? [],
        missing: ["monthlySearchVolume", "monthlySeries", "trend3m"],
        note: keywords?.length
          ? "keywords[].monthlySearchEstimate 是档案备注里的估算，没有写入 keyword-metrics 快照时 demand 和 trend 写 null。"
          : "没有月搜索量，不要把评论数或 Best Sellers Rank 换算成 demand / trend。这两个分数写 null。",
      };
    }
    const series = metrics.monthlySeries;
    const hasSeries = Array.isArray(series) && series.length >= 2;
    const hasTrend = typeof metrics.trend3m === "number" && Number.isFinite(metrics.trend3m);
    const missing: string[] = [];
    if (!hasSeries) missing.push("monthlySeries");
    if (!hasTrend) missing.push("trend3m");
    // 德国档案用德站曲线；美国档案 dossier:US 与 mock/真搜用美国曲线。
    const demandPoints = source.name.startsWith("dossier:US")
      ? DEMAND_POINTS
      : source.name.startsWith("dossier:")
        ? DEMAND_POINTS_DE
        : DEMAND_POINTS;
    const ratio = hasSeries ? seasonalityRatio(series!) : null;
    const peak = hasSeries ? series!.indexOf(Math.max(...series!)) + 1 : null;
    return {
      source: source.name,
      isMock: source.isMock,
      asin: metrics.asin,
      keyword: metrics.keyword,
      monthlySearchVolume: metrics.monthlySearchVolume,
      ...(hasSeries ? { monthlySeries: series } : {}),
      ...(hasTrend ? { trend3m: metrics.trend3m } : {}),
      ...(metrics.peakMonths ? { peakMonths: metrics.peakMonths } : {}),
      seasons: hasSeries
        ? {
            peakMonthIndex: peak,
            maxMinRatio: ratio,
            strongSeasonality: (ratio ?? 1) > 2.5,
          }
        : null,
      scores: {
        demand: Number(piecewise(metrics.monthlySearchVolume, demandPoints).toFixed(4)),
        trend: hasTrend ? Number(trendScore(metrics.trend3m!).toFixed(4)) : null,
      },
      missing,
      note: hasSeries
        ? "scores.demand 已算好，原样写入候选，不要按月搜索量再换一次。"
        : "有月搜索量和环比，没有 12 个月序列。scores.demand 已算好，原样写入，不要编造 monthlySeries，也不要再换算。",
      hint:
        ratio !== null && ratio > 2.5
          ? `旺季与淡季搜索量相差 ${ratio} 倍：现金流要按淡季备货节奏排，考虑是否加 "季节性过强" 风险标记。`
          : hasSeries
            ? "季节性可接受，四季都能出货。"
            : "没有 12 个月序列，季节性无法核实。",
    };
  },
});
