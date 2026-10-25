import { defineTool } from "@typescript-agent-harness/cli";
import { activeMarketSource } from "../lib/sources/index.ts";

// 文件名 search-products.ts → 工具名 search_products。
export default defineTool({
  description:
    "按关键词和价格带从当前选品池拉候选。池子是德国站档案，加上已保存的 amazon.de 搜索页。售价是欧元。返回 asin、标题、类目、售价和 currency。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索词，例如 pet water fountain。有它时优先于 category" },
      category: {
        type: "string",
        description: "类目：outdoor / pet / home / 3c，或直接写搜索词。没有 query 时用它",
      },
      minPriceUsd: { type: "number", description: "最低售价。德国档案按欧元数字过滤" },
      maxPriceUsd: { type: "number", description: "最高售价。德国档案按欧元数字过滤" },
      limit: { type: "number", description: "最多返回条数，默认 8，上限 20" },
    },
    additionalProperties: false,
  },
  async execute(input: { query?: string; category?: string; minPriceUsd?: number; maxPriceUsd?: number; limit?: number }) {
    const source = activeMarketSource();
    const limit = Math.trunc(input.limit ?? 8);
    try {
      const products = await source.searchProducts({
        limit,
        ...(input.query ? { query: input.query } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.minPriceUsd !== undefined ? { minPriceUsd: input.minPriceUsd } : {}),
        ...(input.maxPriceUsd !== undefined ? { maxPriceUsd: input.maxPriceUsd } : {}),
      });
      return {
        source: source.name,
        isMock: source.isMock,
        count: products.length,
        products,
        note:
          products.length === 0
            ? "这个价格带没有搜到商品。换关键词或放宽价格，别自己编 asin。"
            : "下一步：把 products 原样传给 research_candidates。priceUsd 里的数字是 currency 标明的货币。采购成本和 12 个月搜索序列档案里没有，后面标成缺数据。",
      };
    } catch (error) {
      return {
        source: source.name,
        isMock: source.isMock,
        count: 0,
        products: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
