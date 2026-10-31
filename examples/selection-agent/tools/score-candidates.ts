import { defineTool } from "@typescript-agent-harness/cli";
import { loadListingImages } from "../lib/listing-images.ts";
import { validateCandidates } from "../lib/schema.ts";
import {
  rankCandidates,
  toMarkdownTable,
  normalizeWeights,
  WEIGHTS,
  type Weights,
} from "../lib/score.ts";

/**
 * 打分入口：模型只提交结构化字段，分数、封顶、置信度、建议动作全部由 lib/score.ts 算。
 * 校验失败不抛异常，而是把 problems 回给模型补——两次不过就按"数据不足"处理。
 */
export default defineTool({
  description:
    "对一批候选商品跑规则引擎打分并排序。模型不要自己算总分；填好字段后调用本工具，拿回 breakdown、封顶、置信度、建议动作和 markdown 表。",
  inputSchema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        description: "候选商品数组，字段见 AGENTS.md 与 lib/schema.ts",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            category: { type: "string" },
            marketplace: { type: "string" },
            priceUsd: { type: "number" },
            metrics: {
              type: "object",
              properties: {
                demand: { type: "number", description: "0-1，越大越好" },
                trend: { type: "number", description: "0-1，越大越好" },
                competition: { type: "number", description: "0-1，越大越不卷" },
                margin: { type: "number", description: "0-1，越大越好" },
              },
              required: ["demand", "trend", "competition", "margin"],
              additionalProperties: false,
            },
            monthlyProfitUsd: { type: "object", description: "{ low, mid, high }，USD/月" },
            monthlyUnits: { type: "object", description: "{ low, mid, high }，件/月" },
            riskFlags: { type: "array", items: { type: "string" } },
            evidence: { type: "array", items: { type: "object" } },
          },
          required: ["id", "title", "category", "marketplace", "priceUsd", "metrics", "riskFlags", "evidence"],
          additionalProperties: false,
        },
      },
      weights: {
        type: "object",
        description: "可选：覆盖默认权重（需求 0.3 / 趋势 0.2 / 竞争 0.25 / 利润 0.25）。改动会被回显，属于产品决策，需用户同意。",
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  },
  async execute(input: { candidates: unknown[]; weights?: Partial<Weights> }) {
    if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
      return { error: "candidates 不能为空：至少提交一个候选。" };
    }
    const { ok, rejected } = validateCandidates(input.candidates);
    const weights = input.weights ? normalizeWeights(input.weights) : WEIGHTS;
    const rows = rankCandidates(ok, weights);

    return {
      weights,
      weightsChanged: input.weights !== undefined,
      accepted: ok.length,
      rejected,
      rows,
      markdown: ok.length ? toMarkdownTable(rows, loadListingImages()) : undefined,
      next:
        rejected.length > 0
          ? "有候选没通过校验：按 rejected[].problems 补齐字段后重试；补不出来就把该商品标为“数据不足”并说明缺什么。"
          : rows.length > 0
            ? "把 rows 原样交给 save_report 落盘。先不要回复用户。写结论时，回复第一行必须原样用 save_report 返回的 imageMarkdown，不要只出文字表。"
            : "没有候选可排序。",
    };
  },
});
