import { defineTool } from "@typescript-agent-harness/cli";
import { composeBrief } from "../lib/compose.ts";
import { validateBrief, type Failure, type TargetSignals } from "../lib/schema.ts";

/**
 * 规则合成 Brief（含 markdown）。不落盘——下一步再 save_brief。
 */
export default defineTool({
  description:
    "把 signals / failures / truncated 合成 Brief schema + markdown（含相对上次同目标集合的「变更」节）。缺价格写缺数据，不臆造排名。不落盘。skipDiff=true 时跳过变更对比（评测用）。",
  inputSchema: {
    type: "object",
    properties: {
      market: { type: "string" },
      signals: { type: "array", items: { type: "object" } },
      failures: { type: "array", items: { type: "object" } },
      truncated: { type: "boolean" },
      conclusion: { type: "string" },
      skipDiff: { type: "boolean" },
    },
    required: ["signals"],
    additionalProperties: false,
  },
  async execute(input: {
    market?: string;
    signals?: TargetSignals[];
    failures?: Failure[];
    truncated?: boolean;
    conclusion?: string;
    skipDiff?: boolean;
  }) {
    const args: Parameters<typeof composeBrief>[0] = {
      market: "DE",
      signals: input.signals ?? [],
      failures: input.failures ?? [],
      truncated: input.truncated ?? false,
    };
    if (input.conclusion !== undefined) args.conclusion = input.conclusion;
    if (input.skipDiff !== undefined) args.skipDiff = input.skipDiff;
    const brief = composeBrief(args);
    const problems = validateBrief(brief);
    return { brief, problems };
  },
});
