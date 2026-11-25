import { defineTool } from "@typescript-agent-harness/cli";
import type { DayBundle } from "../lib/schema.ts";
import { loadBundle, saveDayCard } from "../lib/save.ts";

export default defineTool({
  description:
    "写入 out/daily/<date>.{md,json}。summary 只能依据 bundle；含 bundle 外的 URL / commit hash 时拒绝。返回 markdown。",
  inputSchema: {
    type: "object",
    properties: { bundle: { type: "object" }, summary: { type: "string" } },
    required: ["bundle", "summary"],
    additionalProperties: false,
  },
  async execute(input: { bundle: DayBundle; summary: string }) {
    // Prefer the bundle persisted by compose_bundle over model-supplied evidence.
    const bundle = (input.bundle && loadBundle(String(input.bundle.date))) || input.bundle;
    const out = saveDayCard(bundle, input.summary);
    return { saved: true, jsonPath: out.jsonPath, mdPath: out.mdPath, markdown: out.markdown };
  },
});
