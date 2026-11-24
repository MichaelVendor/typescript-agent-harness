import { defineTool } from "@typescript-agent-harness/cli";
import { matchRequirements } from "../lib/match.ts";
import { validateMatchResult, type ParseResult } from "../lib/schema.ts";

export default defineTool({
  description:
    "把 parse_pair 的 result 与简历证据逐条对齐：met / partial / missing，missing 进 gaps。不落盘。",
  inputSchema: {
    type: "object",
    properties: { result: { type: "object" } },
    required: ["result"],
    additionalProperties: false,
  },
  async execute(input: { result: ParseResult }) {
    const result = matchRequirements(input.result);
    return { result, problems: validateMatchResult(result) };
  },
});
