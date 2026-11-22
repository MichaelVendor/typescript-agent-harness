import { defineTool } from "@typescript-agent-harness/cli";
import { pullNext } from "../plugins/pull-de-search.ts";

/** 手动拉一轮。定时由 plugins/pull-de-search.ts 每几分钟拉一个词。 */
export default defineTool({
  description:
    "从亚马逊德国站搜索页更新已保存商品的欧元价、评分、评论数和主图。一次只拉一个已有搜索词。不新增商品，不改标题。页面拒绝访问时停到下一轮，不要马上再调。",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute() {
    return pullNext();
  },
});
