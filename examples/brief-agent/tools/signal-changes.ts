import { defineTool } from "@typescript-agent-harness/cli";
import { loadMockCatalog } from "../lib/fetch.ts";
import { extractSignalsFromPage } from "../lib/signals.ts";

export default defineTool({
  description: "按竞品 id 读取变更记录信号桶（只读，mock）。找不到返回 error。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async execute(input: { id: string }) {
    const page = loadMockCatalog().find((p) => p.id === input.id);
    if (!page) return { error: `not found: ${input.id}` };
    return extractSignalsFromPage(page).buckets.changes;
  },
});
