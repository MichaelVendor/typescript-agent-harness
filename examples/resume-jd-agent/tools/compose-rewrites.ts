import { defineTool } from "@typescript-agent-harness/cli";
import { composeRewrites } from "../lib/rewrite.ts";
import type { MatchResult } from "../lib/schema.ts";

export default defineTool({
  description:
    "仅对 partial 且有简历证据的条目生成改写建议；missing 与 met 不生成。用户确认要改写后才调用。不落盘。",
  inputSchema: {
    type: "object",
    properties: { match: { type: "object" } },
    required: ["match"],
    additionalProperties: false,
  },
  async execute(input: { match: MatchResult }) {
    return composeRewrites(input.match);
  },
});
