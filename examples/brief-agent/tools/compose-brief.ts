import { defineTool } from "@typescript-agent-harness/cli";
import { composeBrief } from "../lib/compose.ts";
import { validateBrief, type Failure, type TargetSignals } from "../lib/schema.ts";

/**
 * 规则合成 Brief（含 markdown）。不落盘——下一步再 save_brief。
 */
export default defineTool({
  description:
    "把 signals / failures / truncated 合成 Brief。template=ops（默认细表）或 exec（老板一页纸）。含相对上次同目标集合的变更（exec 进「要事」）。skipDiff=true 跳过对比。不落盘。",
  inputSchema: {
    type: "object",
    properties: {
      market: { type: "string" },
      signals: { type: "array", items: { type: "object" } },
      failures: { type: "array", items: { type: "object" } },
      truncated: { type: "boolean" },
      conclusion: { type: "string" },
      skipDiff: { type: "boolean" },
      template: { type: "string", description: "ops | exec" },
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
    template?: string;
  }) {
    const args: Parameters<typeof composeBrief>[0] = {
      market: "DE",
      signals: input.signals ?? [],
      failures: input.failures ?? [],
      truncated: input.truncated ?? false,
    };
    if (input.conclusion !== undefined) args.conclusion = input.conclusion;
    if (input.skipDiff !== undefined) args.skipDiff = input.skipDiff;
    if (input.template === "exec" || input.template === "ops") args.template = input.template;
    const brief = composeBrief(args);
    const problems = validateBrief(brief);
    return { brief, problems };
  },
});
