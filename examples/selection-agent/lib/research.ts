/**
 * 子 Agent 编排：主 Agent 不再自己一个 asin 一个 asin 地查，
 * 而是把候选切成批次，每批起 N 个 `run_subagent` 并行取证，只收回结构化字段。
 *
 * 分工没变：
 *   - 工具（子 Agent 调的那四个）负责事实；
 *   - 子 Agent 负责把事实整理成 0–1 字段和证据（判断哪个数字重要）；
 *   - lib/score.ts 负责加权、封顶、置信度、动作（规则）；
 *   - 人负责签字。
 *
 * 子 Agent 是靠 `run_subagent` 的 task 文本约束的，它看不到本文件里写的这段说明，
 * 所以铁律在 lib/subagent.ts 的 buildResearchTask 里又写了一遍——两处都要改。
 */
import { SESSION } from "@typescript-agent-harness/agent";
import type { ToolContext } from "@typescript-agent-harness/cli";
import {
  buildResearchTask,
  normalizeConcurrency,
  parseChildReply,
  submittedCandidate,
  planBatches,
  runWithConcurrency,
  type ProductRef,
} from "./subagent.ts";

/** run_subagent 的输入输出形状，照抄 packages/agent/src/subagent-tool.ts。 */
type SubagentResult = {
  sessionId?: string;
  text?: string;
  finishReason?: string;
};

export type ResearchOptions = {
  candidates: ProductRef[];
  /** 同时在飞的子 Agent 数，默认 3，上限 8。 */
  concurrency: number;
  signal: AbortSignal;
  /** 给日志用：告诉调用方第几个批次跑完了。 */
  onBatchDone?: (info: { batch: number; ok: number; failed: number }) => void;
};

export type ResearchOutcome = {
  /** 解析成功且带 id 的候选字段，**未经** schema 校验。 */
  candidates: Record<string, unknown>[];
  failures: { asin: string; stage: "subagent" | "parse"; reason: string }[];
  batches: number;
  sessionIds: string[];
};

function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * 起一批子 Agent。每批自己一组 `runWithConcurrency`，
 * 批次之间串行——这是给真实数据源留的限流阀门，不是性能优化。
 */
export async function researchCandidates(
  ctx: Pick<ToolContext, "runtime">,
  options: ResearchOptions,
): Promise<ResearchOutcome> {
  const concurrency = normalizeConcurrency(options.concurrency);
  const tasks = options.candidates.map((candidate, i) => ({
    batch: Math.floor(i / concurrency) + 1,
    candidate,
  }));
  const batches = planBatches(tasks, concurrency);

  const sessions = ctx.runtime.get(SESSION);
  const out: ResearchOutcome = { candidates: [], failures: [], batches: batches.length, sessionIds: [] };

  for (const [batchIndex, batch] of batches.entries()) {
    if (aborted(options.signal)) {
      for (const task of batch) {
        out.failures.push({ asin: task.candidate.asin, stage: "subagent", reason: "用户取消了本轮运行" });
      }
      continue;
    }

    const settled = await runWithConcurrency(batch, concurrency, async (task) => {
      const child = await sessions.create();
      const result = (await child.run(buildResearchTask(task))) as SubagentResult;
      return {
        asin: task.candidate.asin,
        sessionId: child.id,
        text: result.text ?? "",
        submitted: submittedCandidate(child.messages),
      };
    });

    let ok = 0;
    let failed = 0;
    for (const [i, entry] of settled.entries()) {
      const asin = batch[i]!.candidate.asin;
      if (!entry.ok) {
        failed += 1;
        out.failures.push({ asin, stage: "subagent", reason: entry.error });
        continue;
      }
      out.sessionIds.push(entry.value.sessionId);
      const parsed = entry.value.submitted
        ? { ok: true as const, value: entry.value.submitted }
        : parseChildReply(entry.value.text);
      if (!parsed.ok) {
        failed += 1;
        out.failures.push({ asin, stage: "parse", reason: parsed.reason });
        continue;
      }
      ok += 1;
      // 子 Agent 可能漏写 id：用我们传进去的 asin 兜底，避免落盘时对不上商品。
      out.candidates.push({ id: asin, ...parsed.value });
    }
    options.onBatchDone?.({ batch: batchIndex + 1, ok, failed });
  }

  return out;
}
