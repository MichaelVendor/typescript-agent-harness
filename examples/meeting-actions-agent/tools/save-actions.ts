import { defineTool } from "@typescript-agent-harness/cli";
import type { ActionBatch } from "../lib/confirm.ts";
import { saveActions } from "../lib/save.ts";

export default defineTool({
  description:
    "校验 confirmed 批次后写入 out/actions/<时间戳>.{json,md}，并追加 out/tasks.jsonl。仍有 action 缺负责人时默认拒绝，除非 allowUnowned=true。",
  inputSchema: {
    type: "object",
    properties: {
      batch: { type: "object" },
      allowUnowned: { type: "boolean" },
    },
    required: ["batch"],
    additionalProperties: false,
  },
  async execute(input: { batch: ActionBatch; allowUnowned?: boolean }) {
    const opts =
      input.allowUnowned !== undefined ? { allowUnowned: input.allowUnowned } : undefined;
    const out = saveActions(input.batch, opts);
    return {
      saved: true,
      jsonPath: out.jsonPath,
      mdPath: out.mdPath,
    };
  },
});