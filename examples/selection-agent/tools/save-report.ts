import { defineTool, type ToolContext } from "@typescript-agent-harness/cli";
import { BOARD_REPLY, renderReportBoardSafe } from "../lib/board-shot.ts";
import { REPORT_SAVED } from "../lib/events.ts";
import { buildReport, saveReport } from "../lib/report.ts";
import { validateCandidates, type Candidate } from "../lib/schema.ts";

/**
 * 落盘：把这一轮的打分结果写成 out/reports/<时间戳>.json。
 * 先校验再落盘——磁盘上不留半成品报告，必要时可以重算。
 */
export default defineTool({
  description:
    "把候选与打分结果写入 out/reports/<时间戳>.json（可复算的复盘存档）。会重新跑一遍打分校验字段，返回文件路径。",
  inputSchema: {
    type: "object",
    properties: {
      candidates: { type: "array", description: "与 score_candidates 相同的候选数组", items: { type: "object" } },
      marketplace: { type: "string", description: "站点，例如 US" },
      sourceIsMock: { type: "boolean", description: "是否基于 mock 数据，默认 true" },
    },
    required: ["candidates"],
    additionalProperties: false,
  },
  async execute(
    input: { candidates: unknown[]; marketplace?: string; sourceIsMock?: boolean },
    ctx: ToolContext,
  ) {
    const { ok, rejected } = validateCandidates(input.candidates ?? []);
    if (ok.length === 0) {
      return { saved: false, reason: "没有通过校验的候选，未落盘。", rejected };
    }
    const report = buildReport(ok as Candidate[], {
      marketplace: input.marketplace ?? "US",
      sourceIsMock: input.sourceIsMock ?? true,
    });
    const file = saveReport(report);
    // 落盘路径也发一个事件，plugins/run-log.ts 据此提示。
    ctx.runtime.emit(REPORT_SAVED, { file, candidates: report.candidates });
    const shot = renderReportBoardSafe(report.rows, file);
    return {
      saved: true,
      file,
      candidates: report.candidates,
      topActions: report.rows.map((r) => ({ id: r.id, total: r.total, action: r.action })),
      rejected,
      ...shot,
      markdown: "imageMarkdown" in shot ? `${shot.imageMarkdown}\n\n${report.markdown}` : report.markdown,
      next: `报告已落盘。先不要回复用户。下一步调用 prepare_case，然后只弹 ask_user。等用户点了提交之后，${BOARD_REPLY}`,
    };
  },
});
