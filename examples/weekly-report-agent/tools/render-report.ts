import { defineTool } from "@typescript-agent-harness/cli";
import { renderReport } from "../lib/render.ts";
import type { ExtractResult, ReportTemplate } from "../lib/schema.ts";

export default defineTool({
  description:
    "按已选模板（ops 细表 / exec 一页纸）渲染周报 Markdown。template 必须来自 ask_user 或用户明确选择。不落盘。",
  inputSchema: {
    type: "object",
    properties: {
      result: { type: "object" },
      template: { type: "string", enum: ["ops", "exec"] },
    },
    required: ["result", "template"],
    additionalProperties: false,
  },
  async execute(input: { result: ExtractResult; template: ReportTemplate }) {
    return renderReport(input.result, input.template);
  },
});
