import { defineTool } from "@typescript-agent-harness/cli";
import { extractSignalsForPages } from "../lib/extract.ts";
import type { ProductPage } from "../lib/fetch.ts";

export default defineTool({
  description:
    "对 fetch_product_pages 返回的 pages 做有界并发取证（P0 程序化抽取，不调 LLM）。pages 原样传入；concurrency 默认 3、上限 8。retryFailIds 仅用于 eval 注入失败，生产勿用。",
  inputSchema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        description: "待取证页面，通常直接来自 fetch_product_pages 的 pages",
        items: { type: "object" },
      },
      concurrency: {
        type: "number",
        description: "同时在飞的抽取数，默认 3，上限 8",
      },
      retryFailIds: {
        type: "array",
        items: { type: "string" },
        description: "仅 eval：对这些 id 注入抽取失败",
      },
    },
    required: ["pages"],
    additionalProperties: false,
  },
  async execute(input: {
    pages: ProductPage[];
    concurrency?: number;
    retryFailIds?: string[];
  }) {
    const args: Parameters<typeof extractSignalsForPages>[1] = {};
    if (input.concurrency !== undefined) args.concurrency = input.concurrency;
    if (input.retryFailIds !== undefined) args.retryFailIds = input.retryFailIds;
    return extractSignalsForPages(input.pages ?? [], args);
  },
});
