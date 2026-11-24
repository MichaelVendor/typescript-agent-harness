import { defineTool } from "@typescript-agent-harness/cli";
import { extractItems } from "../lib/extract.ts";
import { validateExtractResult } from "../lib/schema.ts";

export default defineTool({
  description: "从周报杂记原文抽取并归类条目（done/wip/risk/next）；无法归类进 gaps。",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(input: { text?: string }) {
    const result = extractItems(String(input.text ?? ""));
    return { result, problems: validateExtractResult(result) };
  },
});
