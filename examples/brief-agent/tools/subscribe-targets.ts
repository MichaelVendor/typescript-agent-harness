import { defineTool } from "@typescript-agent-harness/cli";
import { upsertSubscription } from "../lib/subscriptions.ts";
import type { TargetRef } from "../lib/targets.ts";

/**
 * 登记/更新本地订阅（out/subscriptions.json），供 weekly-brief 脚本定时跑。
 */
export default defineTool({
  description:
    "登记或更新竞品订阅到 out/subscriptions.json。传入 targets（id/asin/query 等）与可选 template/enabled。定时用 pnpm weekly。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "订阅 id；缺省自动生成" },
      targets: { type: "array", items: { type: "object" } },
      template: { type: "string", description: "ops | exec" },
      enabled: { type: "boolean" },
      note: { type: "string" },
    },
    required: ["targets"],
    additionalProperties: false,
  },
  async execute(input: {
    id?: string;
    targets: TargetRef[];
    template?: string;
    enabled?: boolean;
    note?: string;
  }) {
    const args: Parameters<typeof upsertSubscription>[0] = {
      targets: input.targets,
    };
    if (input.id) args.id = input.id;
    if (input.template === "exec" || input.template === "ops") args.template = input.template;
    if (input.enabled !== undefined) args.enabled = input.enabled;
    if (input.note) args.note = input.note;
    const out = upsertSubscription(args);
    return {
      saved: true,
      filePath: out.filePath,
      subscription: out.subscription,
    };
  },
});
