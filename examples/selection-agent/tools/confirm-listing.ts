import { defineTool } from "@typescript-agent-harness/cli";
import { confirmListing, publishCase } from "../lib/case-state.ts";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 用户确认现有草稿。不改标题和卖点。 */
export default defineTool({
  description: "用户确认现有链接草稿。不改标题、卖点和目标价。没有确认之前不要说链接已定稿。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    confirmListing();
    const prepared = loadPreparedCase();
    publishCase(prepared);
    return {
      saved: true,
      listing: prepared.listing,
      next: "链接草稿已确认，文案没有改。这不是已经上架。",
    };
  },
});
