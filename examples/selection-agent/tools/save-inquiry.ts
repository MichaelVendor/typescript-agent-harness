import { defineTool } from "@typescript-agent-harness/cli";
import { publishCase, saveInquiry } from "../lib/case-state.ts";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 记下用户确认的询盘对象和清单。不编报价，不代替工厂回复。 */
export default defineTool({
  description:
    "记下要对哪个商品发起询盘。asin 和标题必须来自排行榜或 search_products。items 不传时用准备清单里的六项：硅胶净重、成型与后处理、检验、包材、起订量、模费与摊销。这不是已收到报价。",
  inputSchema: {
    type: "object",
    properties: {
      asin: { type: "string", description: "询盘对象 asin" },
      title: { type: "string", description: "询盘对象标题，与 asin 对应" },
      items: {
        type: "array",
        items: { type: "string" },
        description: "询盘项。不传就用准备清单六项",
      },
    },
    required: ["asin", "title"],
    additionalProperties: false,
  },
  async execute(input: { asin: string; title: string; items?: string[] }) {
    try {
      saveInquiry({
        asin: input.asin,
        title: input.title,
        ...(input.items ? { items: input.items } : {}),
      });
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
    const prepared = loadPreparedCase();
    publishCase(prepared);
    return {
      saved: true,
      inquiry: prepared.inquiry,
      next: "询盘清单已记下，还没有工厂报价。不要把清单里的项写成已核实成本，也不要据此改排行榜分数。",
    };
  },
});
