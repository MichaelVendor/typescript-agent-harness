import { defineTool } from "@typescript-agent-harness/cli";
import type { ExtractResult, ReportTemplate } from "../lib/schema.ts";
import { saveReport, selectTemplate } from "../lib/save.ts";

export default defineTool({
  description:
    "按已选模板渲染并写入 out/reports/<时间戳>.{json,md}。template 缺失或非法时拒绝。",
  inputSchema: {
    type: "object",
    properties: {
      result: { type: "object" },
      template: { type: "string", enum: ["ops", "exec"] },
      outDir: { type: "string" },
    },
    required: ["result", "template"],
    additionalProperties: false,
  },
  async execute(input: { result: ExtractResult; template: ReportTemplate; outDir?: string }) {
    const batch = selectTemplate(input.result, input.template);
    const out = saveReport(batch, input.outDir ? { outDir: input.outDir } : undefined);
    return { saved: true, jsonPath: out.jsonPath, mdPath: out.mdPath };
  },
});
