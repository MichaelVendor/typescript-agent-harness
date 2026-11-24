import { defineTool } from "@typescript-agent-harness/cli";
import { composeDraft } from "../lib/compose.ts";
import type { ExtractResult } from "../lib/schema.ts";

export default defineTool({
  description:
    "把 extract_items 的 result 合成待选模板的 Markdown 草稿（已完成 / 进行中 / 风险 / 下周计划 / 缺口）。不落盘。",
  inputSchema: {
    type: "object",
    properties: { result: { type: "object" } },
    required: ["result"],
    additionalProperties: false,
  },
  async execute(input: { result: ExtractResult }) {
    return composeDraft(input.result);
  },
});
