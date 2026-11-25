import path from "node:path";
import { defineTool } from "@typescript-agent-harness/cli";
import { loadWorklogConfig } from "../lib/config.ts";
import { collectCursor } from "../lib/collect-cursor.ts";

export default defineTool({
  description: "按 tah.worklog.json 的 cursor.projectsRoot 采集某天有改动的 Cursor 对话记录。返回 cursor 与 gaps；不落盘。",
  inputSchema: {
    type: "object",
    properties: { date: { type: "string", description: "YYYY-MM-DD" } },
    required: ["date"],
    additionalProperties: false,
  },
  async execute(input: { date: string }) {
    const cfg = loadWorklogConfig(path.resolve("tah.worklog.json"));
    return collectCursor(cfg.cursor.projectsRoot, input.date, cfg.timezone);
  },
});
