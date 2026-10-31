import { defineTool } from "@typescript-agent-harness/cli";
import { saveMarketplace } from "../lib/case-state.ts";
import { activateMarketplace, marketplaceProfile, parseMarketplace } from "../lib/marketplace.ts";
import { activeMarketSource } from "../lib/sources/index.ts";

/** 开场选定站点。整轮搜索、打分、上架都绑这个站。 */
export default defineTool({
  description:
    "记下本轮选品站点：DE 或 US。用户点了「德国站」或「美国站」之后立刻调用。未调用前不要 search_products。磁盘里以前的站点不算数。",
  inputSchema: {
    type: "object",
    properties: {
      marketplace: {
        type: "string",
        description: "DE 或 US，也可传「德国站」「美国站」",
      },
    },
    required: ["marketplace"],
    additionalProperties: false,
  },
  async execute(input: { marketplace?: string }) {
    const market = parseMarketplace(input.marketplace);
    if (!market) {
      return {
        saved: false,
        error: "站点只能是 DE / US，或「德国站」/「美国站」。",
        next: "再 ask_user 一次：选哪个站点？选项「德国站」「美国站」。",
      };
    }
    saveMarketplace(market);
    activateMarketplace(market);
    const profile = marketplaceProfile(market);
    const source = activeMarketSource();
    return {
      saved: true,
      ...profile,
      source: source.name,
      next: `站点已定为${profile.askLabel}（${profile.siteLabel}）。货架价是${profile.shelfUnit}，字段名仍是 priceUsd，看 currency=${profile.currency}。下一步 search_products，再用 research_candidates 和 score_and_save。上架时点「${profile.publishLabel}」。`,
    };
  },
});
