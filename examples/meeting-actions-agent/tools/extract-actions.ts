import { defineTool } from "@typescript-agent-harness/cli";
import { extractActions } from "../lib/extract.ts";
import { validateExtractResult } from "../lib/schema.ts";

export default defineTool({
  description: "从会议转写/纪要原文抽取行动项、决议与信息项。缺负责人填 null，写入 gaps。",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(input: { text?: string }) {
    const result = extractActions(String(input.text ?? ""));
    return { result, problems: validateExtractResult(result) };
  },
});