import { defineTool } from "@typescript-agent-harness/cli";
import { activeMarketSource } from "../lib/sources/index.ts";
import { CAP_RISK_FLAGS, RISK_FLAGS, type RiskFlag } from "../lib/schema.ts";

/**
 * 合规筛查：回答"能不能合法上架、会不会被下架或起诉"。
 * 命中"侵权"或"认证缺失"时，打分引擎会把总分封顶到 0.3——这是硬规则，不是建议。
 */
export default defineTool({
  description:
    "查某商品的合规风险：风险标记（侵权/认证缺失/危险品等）、所需认证、上架前置条件，并提示是否触发总分封顶。",
  inputSchema: {
    type: "object",
    properties: { asin: { type: "string", description: "商品 asin" } },
    required: ["asin"],
    additionalProperties: false,
  },
  async execute(input: { asin: string }) {
    const source = activeMarketSource();
    const asin = input.asin.trim().toUpperCase();
    const report = await source.complianceCheck(asin);
    if (!report) {
      return {
        asin,
        error: `没有 ${asin} 的合规数据。不要假设"无风险"，riskFlags 不要填空数组来表示安全。`,
        source: source.name,
      };
    }
    const caps = report.riskFlags.filter((f) => CAP_RISK_FLAGS.includes(f as RiskFlag));
    return {
      source: source.name,
      isMock: source.isMock,
      ...report,
      unknownFlags: report.riskFlags.filter((f) => !RISK_FLAGS.includes(f as RiskFlag)),
      capTriggered: caps.length > 0,
      capReason: caps.length > 0 ? `${caps.join("、")} 触发总分封顶` : undefined,
      hint:
        caps.length > 0
          ? "把命中的标记原样写进候选的 riskFlags；该商品本批次最高只能给到 0.3，动作只能是“观察”或“放弃”。"
          : "未触发封顶。认证清单写进缺口，不把建议动作从「上架」改掉。",
    };
  },
});
