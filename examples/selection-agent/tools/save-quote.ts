import { defineTool } from "@typescript-agent-harness/cli";
import { publishCase, saveQuote } from "../lib/case-state.ts";
import { loadPreparedCase } from "../lib/prepare.ts";

/** 只记用户给出的人民币报价。不换算欧元利润。 */
export default defineTool({
  description:
    "记下用户刚给出的工厂报价和费用。采购价、模费是人民币。汇率是 1 欧元兑多少人民币。头程和尾程是欧元每件。佣金是 0 到 1 的小数。没给的保持空。五项齐了才按目标价算单件欧元利润，不算月销量。",
  inputSchema: {
    type: "object",
    properties: {
      purchasePrice: { type: "number", description: "采购价，人民币，大于等于 0" },
      moldFee: { type: "number", description: "模费，人民币，大于等于 0" },
      moq: { type: "number", description: "起订量，正整数" },
      cnyPerEur: { type: "number", description: "1 欧元兑多少人民币，必须大于 0" },
      freightEur: { type: "number", description: "单件头程，欧元" },
      fbaFeeEur: { type: "number", description: "单件尾程，欧元" },
      referralRate: { type: "number", description: "佣金比例，0 到 1，例如 0.15" },
    },
    additionalProperties: false,
  },
  async execute(input: {
    purchasePrice?: number;
    moldFee?: number;
    moq?: number;
    cnyPerEur?: number;
    freightEur?: number;
    fbaFeeEur?: number;
    referralRate?: number;
  }) {
    try {
      saveQuote(input);
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
    const prepared = loadPreparedCase();
    publishCase(prepared);
    return {
      saved: true,
      quote: prepared.quote,
      margin: prepared.margin,
      next: prepared.margin
        ? "单件欧元利润已按目标价区间算出。这不是已核实售价，也不是月利润。月搜索量仍然没有，monthlyUnits 和 monthlyProfitUsd 继续写 null。不要把这个利润写进排行榜总分。"
        : "已记下的费用还不够算利润。缺采购价、汇率、头程、尾程或佣金时保持 margin 为 null，不要补默认值。",
    };
  },
});
