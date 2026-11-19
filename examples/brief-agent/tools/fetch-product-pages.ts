import { defineTool } from "@typescript-agent-harness/cli";
import { fetchProductPages } from "../lib/fetch.ts";

export default defineTool({
  description:
    "按目标 id 拉取竞品详情页（P0 读 mock 档案）。ids 必填。failIds 仅用于 eval 注入失败，生产勿用。",
  inputSchema: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" } },
      failIds: { type: "array", items: { type: "string" } },
    },
    required: ["ids"],
    additionalProperties: false,
  },
  async execute(input: { ids: string[]; failIds?: string[] }) {
    const args: Parameters<typeof fetchProductPages>[0] = { ids: input.ids };
    if (input.failIds !== undefined) args.failIds = input.failIds;
    return fetchProductPages(args);
  },
});