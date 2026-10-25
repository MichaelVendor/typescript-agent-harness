import { defineTool } from "@typescript-agent-harness/cli";
import { publishCase, saveShelf } from "../lib/case-state.ts";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 把排行榜里点中的商品写成模拟后台草稿。不改写标题，不套用档案卖点。 */
export default defineTool({
  description:
    "记下用户从排行榜点中的上架商品。asin、标题、类目和欧元售价必须来自 search_products，不要改。卖点留空，不要把档案提案的文案套到别的商品上。",
  inputSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "search_products 返回的 asin" },
      title: { type: "string", description: "search_products 返回的标题" },
      priceEur: { type: "number", description: "search_products 的 priceUsd，德国站是欧元" },
      category: { type: "string", description: "search_products 返回的类目" },
    },
    required: ["sku", "title", "priceEur", "category"],
    additionalProperties: false,
  },
  async execute(input: { sku?: string; title?: string; priceEur?: number; category?: string }) {
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
    publishCase(prepared);
    return {
      saved: true,
      shelf: prepared.shelf,
      next: "模拟后台草稿会换成这条商品。卖点是空的。有搜索页主图就用那张，没有就留演示图。标题用搜索页原文。演示编码、VAT 说明、入库单和广告状态都不是真实税号、条码、件数或花费。打开页面后核对标题和欧元价，不要改成档案提案。发布后再打开买家页面。",
    };
  },
});
