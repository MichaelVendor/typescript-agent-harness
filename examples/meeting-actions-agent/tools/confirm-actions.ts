import { defineTool } from "@typescript-agent-harness/cli";
import { confirmActions } from "../lib/confirm.ts";
import type { ExtractResult } from "../lib/schema.ts";

export default defineTool({
  description:
    "合并 ask_user 或用户给出的负责人/优先级补丁，产出 confirmed 批次，供 save_actions 使用。",
  inputSchema: {
    type: "object",
    properties: {
      result: { type: "object" },
      patches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            owner: { type: "string", description: "负责人；可传 null 表示仍缺" },
            priority: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    required: ["result", "patches"],
    additionalProperties: false,
  },
  async execute(input: {
    result: ExtractResult;
    patches: Array<{ id: string; owner?: string | null; priority?: "P0" | "P1" | "P2" }>;
  }) {
    const batch = confirmActions(input.result, input.patches ?? []);
    return { batch };
  },
});