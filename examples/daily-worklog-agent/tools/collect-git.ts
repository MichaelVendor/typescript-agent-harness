import path from "node:path";
import { defineTool } from "@typescript-agent-harness/cli";
import { loadWorklogConfig } from "../lib/config.ts";
import { collectGit } from "../lib/collect-git.ts";

export default defineTool({
  description: "按 tah.worklog.json 的 repos 采集某天的 git 提交。返回 git 与 gaps；不落盘。",
  inputSchema: {
    type: "object",
    properties: { date: { type: "string", description: "YYYY-MM-DD" } },
    required: ["date"],
    additionalProperties: false,
  },
  async execute(input: { date: string }) {
    const cfg = loadWorklogConfig(path.resolve("tah.worklog.json"));
    return collectGit(cfg.repos, input.date, cfg.timezone);
  },
});
