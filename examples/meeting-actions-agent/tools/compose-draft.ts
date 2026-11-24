import { defineTool } from "@typescript-agent-harness/cli";
import { composeDraft } from "../lib/compose.ts";
import type { ExtractResult } from "../lib/schema.ts";

export default defineTool({
  description:
    "把 extract_actions 的 result 合成待确认 Markdown（行动项表 / 待确认 / 缺口）。不落盘。",
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