import { defineTool, type ToolContext } from "@typescript-agent-harness/cli";
import { researchCandidates } from "../lib/research.ts";
import type { ProductRef } from "../lib/subagent.ts";

/**
 * 并行取证：一个候选派一个子 Agent，子 Agent 自己调 keyword_metrics /
 * competitor_snapshot / landed_cost / compliance_check，再用 submit_candidate 交回字段。
 *
 * 主 Agent 不该逐个 asin 自己查——8 个候选 × 4 个工具串行下来，
 * 上下文里全是别人的原始数据，第 3 个候选之后判断就开始飘。
 * 拆出去以后，主 Agent 的上下文里只有候选的结构化字段和失败清单。
 */
export default defineTool({
  description:
    "把候选池按并发数分批，每批起若干子 Agent 并行取证（需求/竞争/利润/合规四个工具由子 Agent 自己调），回收每个候选的 0-1 字段与 evidence。这一步不出分、不排序。",
  inputSchema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        description: "待取证的候选，通常直接来自 search_products 的 products",
        items: {
          type: "object",
          properties: {
            asin: { type: "string" },
            title: { type: "string" },
            category: { type: "string" },
            marketplace: { type: "string" },
            priceUsd: { type: "number" },
          },
          required: ["asin", "title", "category", "marketplace", "priceUsd"],
          additionalProperties: false,
        },
      },
      concurrency: {
        type: "number",
        description: "同时在飞的子 Agent 数，默认 3，上限 8；接真实数据源时调低避免限流",
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  },
  async execute(
    input: { candidates: ProductRef[]; concurrency?: number },
    ctx: ToolContext,
  ) {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    if (candidates.length === 0) {
      return { error: "candidates 不能为空：先用 search_products 拉候选池。" };
    }

    const startedAt = Date.now();
    const outcome = await researchCandidates(ctx, {
      candidates,
      concurrency: input.concurrency ?? 3,
      signal: ctx.signal,
    });

    return {
      batches: outcome.batches,
      requested: candidates.length,
      collected: outcome.candidates.length,
      failed: outcome.failures.length,
      failures: outcome.failures,
      // 子 Agent 的 sessionId 留着复盘：出问题的候选可以去翻它是怎么把字段填歪的。
      subagentSessions: outcome.sessionIds,
      candidates: outcome.candidates,
      partial: outcome.failures.length > 0,
      elapsedMs: Date.now() - startedAt,
      next:
        outcome.candidates.length === 0
          ? "一个都没取回来：检查子 Agent 是否真的调到了四个工具，别自己补数字。"
          : "把这些 candidates 原样传给 score_and_save 打分并落盘。失败的候选要在报告里单列“数据不足”，不要重试超过一次。",
    };
  },
});
