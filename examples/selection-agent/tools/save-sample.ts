import { defineTool } from "@typescript-agent-harness/cli";
import { publishCase, saveSample } from "../lib/case-state.ts";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 只记用户给出的试样结果，不替用户判通过。 */
export default defineTool({
  description:
    "按试样编号记下用户给出的结果原文。编号必须是 prepare_case 里已有的。不要替用户写成通过或不通过。",
  inputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            result: { type: "string" },
          },
          required: ["id", "result"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
  async execute(input: { results?: { id: string; result: string }[] }) {
    const current = loadPreparedCase();
    try {
      saveSample(input.results ?? [], current.sample.checks.map((item) => item.id));
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
    const prepared = loadPreparedCase();
    publishCase(prepared);
    return {
      saved: true,
      sample: prepared.sample,
      next: "试样结果已按原文记下。没测的编号保持空。不要根据这些句子改分数。",
    };
  },
});
