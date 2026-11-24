import { defineTool } from "@typescript-agent-harness/cli";
import type { MatchResult, RewriteItem } from "../lib/schema.ts";
import { saveReport, selectIncludeRewrites } from "../lib/save.ts";

export default defineTool({
  description:
    "写入 out/match/<时间戳>.{json,md}。includeRewrites 必须来自 ask_user 或用户明确回答；缺失时拒绝。",
  inputSchema: {
    type: "object",
    properties: {
      match: { type: "object" },
      includeRewrites: { type: "boolean" },
      rewrites: { type: "array", items: { type: "object" } },
    },
    required: ["match", "includeRewrites"],
    additionalProperties: false,
  },
  async execute(input: {
    match: MatchResult;
    includeRewrites: boolean;
    rewrites?: RewriteItem[];
  }) {
    const batch = selectIncludeRewrites(input.match, input.includeRewrites, input.rewrites);
    const out = saveReport(batch);
    return { saved: true, jsonPath: out.jsonPath, mdPath: out.mdPath };
  },
});
