import { defineTool } from "@typescript-agent-harness/cli";
import { parsePair } from "../lib/parse.ts";

export default defineTool({
  description:
    "把「===简历=== / ===JD===」粘贴原文拆成简历 bullets 与 JD 要求（【必须】/【加分】）。不落盘。",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(input: { text?: string }) {
    const result = parsePair(String(input.text ?? ""));
    const problems: string[] = [];
    if (result.resumeBullets.length === 0) problems.push("未解析到简历 bullet");
    if (result.jdRequirements.length === 0) problems.push("未解析到 JD 要求");
    return { result, problems };
  },
});
