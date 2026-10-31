import { defineTool } from "@typescript-agent-harness/cli";
import { activeMarketSource } from "../lib/sources/index.ts";
import { competitionScore } from "../lib/normalize.ts";

/**
 * 竞争分析：回答"头部是不是被钉死了、新人能不能挤进 Top10"。
 * 注意 competition 分越大表示越不卷，方向和其它维度一致（都越大越好）。
 */
export default defineTool({
  description:
    "查某商品的竞争格局：Top10 评论数分布、头部品牌集中度、中位上架月龄、低评论数链接占比，并给出 0-1 的 competition 分（越大越不卷）。",
  inputSchema: {
    type: "object",
    properties: {
      asin: { type: "string", description: "商品 asin" },
      title: { type: "string", description: "商品标题。用来搜同类，不要省略" },
    },
    required: ["asin", "title"],
    additionalProperties: false,
  },
  async execute(input: { asin: string; title?: string }) {
    const source = activeMarketSource();
    const asin = input.asin.trim().toUpperCase();
    const snapshot = await source.competitorSnapshot(asin, input.title ? { title: input.title } : undefined);
    if (!snapshot || (snapshot.topSellerReviews.length < 5 && !snapshot.closedSet)) {
      return {
        asin,
        source: source.name,
        isMock: source.isMock,
        topSellerReviews: snapshot?.topSellerReviews ?? [],
        sampleSize: snapshot?.topSellerReviews.length ?? 0,
        note: `同类搜索只解析到 ${snapshot?.topSellerReviews.length ?? 0} 条评论数，不够 5 条，不能当成 Top10。competition 写 null。`,
      };
    }
    const brandKnown = snapshot.brandConcentration !== null;
    const missing = [
      ...(snapshot.brandConcentration === null ? ["brandConcentration"] : []),
      ...(snapshot.medianListingAgeMonths === null ? ["medianListingAgeMonths"] : []),
    ];
    const score = brandKnown
      ? competitionScore(snapshot.lowReviewShare, snapshot.brandConcentration!)
      : Math.min(Math.max(snapshot.lowReviewShare, 0), 1);
    return {
      source: source.name,
      isMock: source.isMock,
      ...snapshot,
      scores: { competition: Number(score.toFixed(4)) },
      missing,
      hint: brandKnown
        ? snapshot.brandConcentration! >= 0.6
          ? `头部品牌占 Top10 销量的 ${Math.round(snapshot.brandConcentration! * 100)}%，新品切入门槛高。`
          : "品牌集中度不高，存在差异化切入空间。"
        : snapshot.closedSet
          ? `档案里有 ${snapshot.topSellerReviews.length} 个竞品，不是搜索页 Top10。没有品牌销量份额，competition 只等于低评论占比。`
          : "scores.competition 已按这批评论数算好，原样写入。评论数够 5 条，不要再写竞争样本不足。",
    };
  },
});
