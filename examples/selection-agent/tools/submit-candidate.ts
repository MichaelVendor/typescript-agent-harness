import { defineTool } from "@typescript-agent-harness/cli";

/**
 * 取证子任务的交卷口。字段放在工具参数里，不写进聊天回复。
 * 主会话不要调用；主会话走 research_candidates。
 */
export default defineTool({
  description:
    "取证子任务把一个候选的字段交回。只供子任务调用，主会话不要调用。调用后最终回复只写“完成”，不要再输出 JSON。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      category: { type: "string" },
      marketplace: { type: "string" },
      priceUsd: { type: "number" },
      metrics: { type: "object" },
      monthlyProfitUsd: {},
      monthlyUnits: {},
      riskFlags: { type: "array" },
      evidence: { type: "array" },
      gaps: { type: "array" },
    },
    required: ["id", "metrics", "evidence"],
    additionalProperties: true,
  },
  async execute(input: { id?: string }) {
    return { accepted: true, id: input.id ?? "" };
  },
});
