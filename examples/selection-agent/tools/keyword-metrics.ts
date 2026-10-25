import { defineTool } from "@typescript-agent-harness/cli";
import { activeMarketSource } from "../lib/sources/index.ts";
import { DEMAND_POINTS, piecewise, seasonalityRatio, trendScore } from "../lib/normalize.ts";

/**
 * 需求与趋势：回答"有人搜吗、在涨还是在跌、是不是只有旺季能卖"。
 * 归一化在这里算好返回，模型不用自己插值——AGENTS.md 的换算表以 lib/normalize.ts 为准。
 */
export default defineTool({
  description:
    "查某商品的需求与趋势。有月搜索量时给出 demand/trend 分；亚马逊页面没有月搜索量时只返回评论数和排名，此时分数必须写 null。",
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
          ? "keywords[].monthlySearchEstimate 是档案备注里的估算，没有 12 个月序列。demand 和 trend 写 null，不要把估算值填进 scores。"
          : "没有月搜索量，不要把评论数或 Best Sellers Rank 换算成 demand / trend。这两个分数写 null。",
      };
    }
    const ratio = seasonalityRatio(metrics.monthlySeries);
    const peak = metrics.monthlySeries.indexOf(Math.max(...metrics.monthlySeries)) + 1;
    return {
      source: source.name,
      isMock: source.isMock,
      ...metrics,
      seasons: {
        peakMonthIndex: peak,
        maxMinRatio: ratio,
        strongSeasonality: ratio > 2.5,
      },
      scores: {
        demand: Number(piecewise(metrics.monthlySearchVolume, DEMAND_POINTS).toFixed(4)),
        trend: Number(trendScore(metrics.trend3m).toFixed(4)),
      },
      hint:
        ratio > 2.5
          ? `旺季与淡季搜索量相差 ${ratio} 倍：现金流要按淡季备货节奏排，考虑是否加 "季节性过强" 风险标记。`
          : "季节性可接受，四季都能出货。",
    };
  },
});
