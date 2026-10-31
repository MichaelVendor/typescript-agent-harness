import { defineTool } from "@typescript-agent-harness/cli";
import { publishCase, saveShelf } from "../lib/case-state.ts";
import { requireMarketplace } from "../lib/marketplace.ts";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 把排行榜里点中的商品写成模拟后台草稿。不改写标题，不套用档案卖点。 */
export default defineTool({
  description:
    "记下用户从排行榜点中的上架商品。asin、标题、类目和售价必须来自 search_products，不要改。售价字段名是 priceEur，数字是当前站货币。卖点留空，不要把档案提案的文案套到别的商品上。",
  inputSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "search_products 返回的 asin" },
      title: { type: "string", description: "search_products 返回的标题" },
      priceEur: { type: "number", description: "search_products 的 priceUsd，按当前站货币" },
      category: { type: "string", description: "search_products 返回的类目" },
    },
    required: ["sku", "title", "priceEur", "category"],
    additionalProperties: false,
  },
  async execute(input: { sku?: string; title?: string; priceEur?: number; category?: string }) {
    let profile;
    try {
      profile = requireMarketplace();
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
    try {
      saveShelf({
        sku: input.sku ?? "",
        title: input.title ?? "",
        priceEur: input.priceEur ?? 0,
        category: input.category ?? "",
      });
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
    const prepared = loadPreparedCase();
    publishCase({ ...prepared, marketplace: profile.marketplace });
    return {
      saved: true,
      shelf: prepared.shelf,
      marketplace: profile.marketplace,
      currency: profile.currency,
      siteLabel: profile.siteLabel,
      publishLabel: profile.publishLabel,
      next: `模拟后台草稿会换成这条商品（${profile.siteLabel}）。卖点是空的。有搜索页主图就用那张，没有就留演示图。标题用搜索页原文。下一步立刻调用 browser_open，参数必须带 url："http://127.0.0.1:7455/"，不要空参数，也不要省略 url。打开后用 seller / demo 登录，核对标题和${profile.shelfUnit}价，不要改成档案提案。再点准备、编辑链接、入库、广告，最后点「${profile.publishLabel}」，再打开买家页面。`,
    };
  },
});
