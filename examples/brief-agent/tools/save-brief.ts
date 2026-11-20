import { defineTool, type ToolContext } from "@typescript-agent-harness/cli";
import { BRIEF_SAVED } from "../lib/events.ts";
import { saveBrief } from "../lib/save.ts";
import type { Brief } from "../lib/schema.ts";

/**
 * 校验后落盘 out/briefs/<ts>.{json,md}。只负责写盘，不重新 compose。
 */
export default defineTool({
  description:
    "校验 Brief 后写入 out/briefs/<时间戳>.json 与 .md，并追加一行 out/tasks.jsonl（计费底）。入参为完整 brief（含 markdown）。返回路径。",
  inputSchema: {
    type: "object",
    properties: {
      brief: { type: "object" },
    },
    required: ["brief"],
    additionalProperties: false,
  },
  async execute(input: { brief: Brief }, ctx: ToolContext) {
    const out = saveBrief(input.brief);
    ctx.runtime.emit(BRIEF_SAVED, { jsonPath: out.jsonPath, mdPath: out.mdPath });
    return {
      saved: true,
      jsonPath: out.jsonPath,
      mdPath: out.mdPath,
      markdown: out.markdown,
      tasksPath: out.tasksPath,
      taskLogged: out.taskLogged,
    };
  },
});
