import { defineTool } from "@typescript-agent-harness/cli";
import { resolveTargets } from "../lib/targets.ts";

export default defineTool({
  description: "把用户给的竞品 URL/ASIN/标题/类目词规范成目标列表。最多 8 个，超出截断并声明。market 固定 DE。",
  inputSchema: {
    type: "object",
    properties: {
      targets: { type: "array", items: { type: "object" } },
      query: { type: "string" },
      market: { type: "string" },
    },
    additionalProperties: false,
  },
  async execute(input: { targets?: unknown[]; query?: string; market?: string }) {
    const args: Parameters<typeof resolveTargets>[0] = {
      targets: (input.targets ?? []) as Array<Record<string, string>>,
    };
    if (input.market !== undefined) args.market = input.market;
    if (input.query !== undefined) args.query = input.query;
    return resolveTargets(args);
  },
});