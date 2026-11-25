import { defineTool } from "@typescript-agent-harness/cli";
import { composeBundle, type BundleParts } from "../lib/compose.ts";

export default defineTool({
  description: "把三个 collect_* 工具的结果合成 DayBundle（含 gaps 去重与校验）。不落盘。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string" },
      git: { type: "array" },
      cursor: { type: "array" },
      browser: { type: "array" },
      gaps: { type: "array", items: { type: "string" } },
    },
    required: ["date"],
    additionalProperties: false,
  },
  async execute(input: BundleParts) {
    return composeBundle(input);
  },
});
