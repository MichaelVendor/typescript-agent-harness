import { defineTool, type ToolContext } from "@typescript-agent-harness/cli";
import { REPORT_SAVED } from "../lib/events.ts";
import { buildReport, saveReport, type DataGap } from "../lib/report.ts";
import { validateCandidates, type Candidate } from "../lib/schema.ts";
import { normalizeWeights, rankCandidates, toMarkdownTable, WEIGHTS, type Weights } from "../lib/score.ts";

/**
 * 并行编排的收口：把 research_candidates 收回来的字段一次算分并落盘。
 *
 * 为什么把 score_candidates 和 save_report 合成一步：
 * 子 Agent 是并行的，字段回来的顺序是乱的；如果先打分再落盘分两次调，
 * 中间模型完全有机会\"顺手改一下\"某个数字。合成一个工具后，
 * 从字段到报告只经过 lib/score.ts 这一个纯函数，复算结果必然一致。
 * 原来的 score_candidates / save_report 保留给单候选手工复核用。
 */
export default defineTool({
  description:
    "把 research_candidates 收回的候选字段一次做完：校验 → 规则引擎打分 → 排序 → 写 out/reports/<时间戳>.json。模型不要自己算分，也不要改字段。",
  inputSchema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        description: "research_candidates 返回的 candidates，原样传，不要改字段",
        items: { type: "object" },
      },
      marketplace: { type: "string", description: "站点，例如 US" },
      sourceIsMock: { type: "boolean", description: "是否基于 mock 数据，默认 true" },
      weights: {
        type: "object",
        description: "可选：覆盖默认权重（需求 0.3 / 趋势 0.2 / 竞争 0.25 / 利润 0.25）。属于产品决策，改前必须问用户。",
      },
      knownFailures: {
        type: "array",
        description: "research_candidates 里的 failures，原样带上；会写进报告的 dataGaps 供复盘",
        items: { type: "object" },
      },
    },
    required: ["candidates"],
    additionalProperties: false,
  },
  async execute(
    input: {
      candidates: unknown[];
      marketplace?: string;
      sourceIsMock?: boolean;
      weights?: Partial<Weights>;
      knownFailures?: unknown[];
    },
    ctx: ToolContext,
  ) {
    const inputs = Array.isArray(input.candidates) ? input.candidates : [];
    if (inputs.length === 0) {
      return { saved: false, reason: "candidates 不能为空：先跑 research_candidates 取证。" };
    }

    const { ok, rejected } = validateCandidates(inputs);
    const weights = input.weights ? normalizeWeights(input.weights) : WEIGHTS;
    const rows = rankCandidates(ok as Candidate[], weights);

    // 没用上已知失败的候选名，说明这些商品连字段都没凑齐——报告里必须单列，不能悄悄消失。
    // 先按子 Agent 给的 id 归位（id 可能被它改过），拿不到就用 index 占位。
    const rejectedIds = rejected.map((r) => {
      const c = inputs[r.index] as { id?: unknown } | undefined;
      return typeof c?.id === "string" ? c.id : `#${r.index}`;
    });

    const report = buildReport(ok as Candidate[], {
      marketplace: input.marketplace ?? "US",
      sourceIsMock: input.sourceIsMock ?? true,
      weights,
      dataGaps: {
        rejected: rejectedIds,
        knownFailures: toFailures(input.knownFailures),
      },
    });
    const file = saveReport(report);
    ctx.runtime.emit(REPORT_SAVED, { file, candidates: report.candidates });

    return {
      saved: true,
      file,
      generatedAt: report.generatedAt,
      weights,
      weightsChanged: input.weights !== undefined,
      sourced: report.candidates,
      rejected: rejected.map((r, i) => ({ id: rejectedIds[i], problems: r.problems })),
      rows,
      markdown: rows.length ? toMarkdownTable(rows) : undefined,
      next:
        rows.length === 0
          ? "没有通过校验的候选：按 rejected[].problems 说明缺什么，把它们标成“数据不足”。"
          : "报告已落盘。先不要回复用户。下一步调用 prepare_case。markdown 留到 prepare_case 之后、询问是否上架之前再贴。",
    };
  },
});

type Failure = NonNullable<DataGap["knownFailures"]>[number];

/**
 * 模型会把 failures 原样带回来，但不保证没动过；这里收窄成三元组，
 * 免得报告里混进一坨来路不明的字段。
 */
function toFailures(input: unknown[] | undefined): Failure[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const f = item as { asin?: unknown; stage?: unknown; reason?: unknown };
    return [
      {
        asin: typeof f.asin === "string" ? f.asin : "?",
        stage: typeof f.stage === "string" ? f.stage : "?",
        reason: typeof f.reason === "string" ? f.reason : "?",
      },
    ];
  });
}
