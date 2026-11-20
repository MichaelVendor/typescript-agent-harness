import { defineTool } from "@typescript-agent-harness/cli";
import { fetchProductPages } from "../lib/fetch.ts";
import type { TargetRef } from "../lib/targets.ts";

export default defineTool({
  description:
    "拉取竞品页。默认 mock（BRIEF_SOURCE）；live 时拉 DE 搜索 HTML。优先传 resolve_targets 的 targets（含 asin/query）；也可只传 ids。failIds 仅 mock/eval 注入，生产勿用。",
  inputSchema: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" } },
      targets: { type: "array", items: { type: "object" } },
      failIds: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  async execute(input: {
    ids?: string[];
    targets?: TargetRef[];
    failIds?: string[];
  }) {
    const args: Parameters<typeof fetchProductPages>[0] = {};
    if (input.targets !== undefined) args.targets = input.targets;
    else if (input.ids !== undefined) args.ids = input.ids;
    else return { pages: [], failures: [{ id: "", stage: "fetch", message: "ids or targets required" }] };
    if (input.failIds !== undefined) args.failIds = input.failIds;
    return fetchProductPages(args);
  },
});
