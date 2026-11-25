import { defineTool } from "@typescript-agent-harness/cli";
import { saveBundle } from "../lib/save.ts";
import { composeBundle, type BundleParts } from "../lib/compose.ts";

export default defineTool({
  description: "把三个 collect_* 工具的结果合成 DayBundle（含 gaps 去重与校验）。并落盘 out/bundles/<date>.json（save_day_card 以此为准）。",
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
    const bundle = composeBundle(input);
    saveBundle(bundle);
    return bundle;
  },
});
