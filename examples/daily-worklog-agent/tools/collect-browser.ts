import path from "node:path";
import { defineTool } from "@typescript-agent-harness/cli";
import { loadWorklogConfig } from "../lib/config.ts";
import { collectBrowser } from "../lib/collect-browser.ts";

export default defineTool({
  description: "按 tah.worklog.json 的域名白名单采集某天的浏览器历史。返回 browser 与 gaps；不落盘。",
  inputSchema: {
    type: "object",
    properties: { date: { type: "string", description: "YYYY-MM-DD" } },
    required: ["date"],
    additionalProperties: false,
  },
  async execute(input: { date: string }) {
    const cfg = loadWorklogConfig(path.resolve("tah.worklog.json"));
    return collectBrowser({
      historyDb: cfg.browser.historyDb,
      domainAllowlist: cfg.browser.domainAllowlist,
      date: input.date,
      timezone: cfg.timezone,
    });
  },
});
