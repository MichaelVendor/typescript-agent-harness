import { defineTool } from "@typescript-agent-harness/cli";
import type { MatchResult } from "../lib/schema.ts";
import { saveReport, selectIncludeRewrites } from "../lib/save.ts";

export default defineTool({
  description:
    "写入 out/match/<时间戳>.{json,md}。includeRewrites 必须来自 ask_user 或用户明确回答；缺失时拒绝。yes 时由工具自算改写；返回 markdown 供最终回复使用。",
  inputSchema: {
    type: "object",
    properties: {
      match: { type: "object" },
      includeRewrites: { type: "boolean" },
    },
    required: ["match", "includeRewrites"],
    additionalProperties: false,
  },
  async execute(input: { match: MatchResult; includeRewrites: boolean }) {
    const batch = selectIncludeRewrites(input.match, input.includeRewrites);
    const out = saveReport(batch);
    return { saved: true, jsonPath: out.jsonPath, mdPath: out.mdPath, markdown: out.markdown };
  },
});
