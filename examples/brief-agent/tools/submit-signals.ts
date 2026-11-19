import { defineTool } from "@typescript-agent-harness/cli";

/**
 * 信号子任务的交卷口。字段放在工具参数里，不写进聊天回复。
 * 主会话不要调用；主会话走 extract_signals / compose。
 */
export default defineTool({
  description:
    "信号子任务把一个竞品的 TargetSignals 交回。只供子任务调用，主会话不要调用。调用后最终回复只写“完成”，不要再输出 JSON。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      buckets: { type: "object" },
    },
    required: ["id", "title", "buckets"],
    additionalProperties: true,
  },
  async execute(input: { id?: string }) {
    return { accepted: true, id: input.id ?? "" };
  },
});
