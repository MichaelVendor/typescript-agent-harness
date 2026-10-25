import { defineTool } from "@typescript-agent-harness/cli";
import { activeMarketSource } from "../lib/sources/index.ts";
import { marginScore, unitEstimate } from "../lib/normalize.ts";

/**
 * 利润测算：采购 + 头程 + FBA + 佣金，反推单件净利与净利率。
 * 区间输出：售价按 ±10% 波动、销量按转化率区间，绝不给点值。
 */
export default defineTool({
  description:
    "测算某商品的落地成本与利润：采购价、头程、FBA、佣金、单件净利、净利率、MOQ 与首单资金，并给出 0-1 的 margin 分和月利润/月销量区间。",
  inputSchema: {
    type: "object",
    properties: {
      asin: { type: "string", description: "商品 asin" },
      priceUsd: { type: "number", description: "售价（USD）；不传则用 mock 源里的默认售价" },
    },
    required: ["asin"],
    additionalProperties: false,
  },
  async execute(input: { asin: string; priceUsd?: number }) {
    const source = activeMarketSource();
    const asin = input.asin.trim().toUpperCase();
    const facts = await source.facts?.(asin);
    const priceUsd = input.priceUsd ?? facts?.priceUsd;
    if (!priceUsd) {
      return {
        asin,
        error: `没有 ${asin} 的售价，请显式传 priceUsd。不要编造成本。`,
        source: source.name,
      };
    }
    const cost = await source.landedCost(asin, { priceUsd });
    if (!cost) {
      return {
        asin,
        source: source.name,
        isMock: source.isMock,
        priceUsd,
        currency: facts?.currency ?? null,
        observed: { weightLb: facts?.weightLb ?? null },
        missing: ["purchasePriceUsd", "freightPerUnitUsd", "fbaFeeUsd", "netMargin"],
        note:
          facts?.currency === "EUR"
            ? "售价数字是欧元。档案没有采购价、头程和尾程。margin、monthlyProfitUsd、monthlyUnits 都写 null，不要把售价当成利润。"
            : "页面上没有采购价、头程和 FBA。margin、monthlyProfitUsd、monthlyUnits 都写 null，不要用售价冒充利润。",
      };
    }

    // 售价 ±10% 的敏感性：成本项按 USD 计价不随售价变，佣金随售价变。
    const at = (p: number) =>
      p - cost.purchasePriceUsd - cost.freightPerUnitUsd - cost.fbaFeeUsd - p * cost.referralRate;
    const lowPrice = priceUsd * 0.9;
    const highPrice = priceUsd * 1.1;
    const profitRange = {
      low: Number(at(lowPrice).toFixed(2)),
      mid: Number(cost.netProfitUsd.toFixed(2)),
      high: Number(at(highPrice).toFixed(2)),
    };

    const metrics = await source.keywordMetrics(asin);
    const units = metrics
      ? unitEstimate(metrics.monthlySearchVolume)
      : { low: 0, mid: 0, high: 0 };
    const monthlyProfitUsd = {
      low: Math.round(profitRange.low * units.low),
      mid: Math.round(profitRange.mid * units.mid),
      high: Math.round(profitRange.high * units.high),
    };

    return {
      source: source.name,
      isMock: source.isMock,
      priceUsd,
      ...cost,
      sensitivity: {
        priceRangeUsd: { low: Number(lowPrice.toFixed(2)), high: Number(highPrice.toFixed(2)) },
        profitPerUnitUsd: profitRange,
      },
      monthlyProfitUsd,
      monthlyUnits: units,
      scores: { margin: Number(marginScore(cost.netMargin).toFixed(4)) },
      hint:
        cost.netMargin < 0.15
          ? "净利率低于 15%，广告费和退货很容易把利润吃光，建议先谈采购价或改包装降 FBA 费。"
          : "净利率可覆盖广告与退货，仍有降价空间。",
    };
  },
});
