/**
 * 按候选拆分的取证单元 —— 纯函数，不调模型、不读文件。
 *
 * 为什么要拆：一个主 Agent 串行收集 8 个候选 × 4 个工具 = 32 次工具调用，
 * 聊天记录会撑爆、而且第 3 个候选之后它的注意力和第 1 个已经不一样了。
 * 拆成\"一个候选一个子 Agent\"后，每个子 Agent 的上下文里只有自己的商品，
 * 字段交给 submit_candidate，不写进聊天；合并、打分、排序仍由主 Agent 用规则引擎做。
 *
 * 这里负责三件可测的事：
 *   1. 把候选切成批次（子 Agent 并发是有成本的，不能一次开 8 个）
 *   2. 生成给子 Agent 的任务文本（铁律要写进任务里，子 Agent 看不到 AGENTS.md 之外的东西）
 *   3. 解析子 Agent 回来的文本（它可能包 ```json 代码块，也可能写散文）
 */

export type ProductRef = {
  asin: string;
  title: string;
  category: string;
  marketplace: string;
  priceUsd: number;
};

/** 单个候选的取证任务。 */
export type ResearchTask = {
  /** 批次序号，从 1 开始，写进任务文本方便子 Agent 自述。 */
  batch: number;
  candidate: ProductRef;
};

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;

/** 并发数收敛到 1..8：0 或负数会让批次无限大，太大会同时打爆数据源限流。 */
export function normalizeConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.trunc(value)));
}

/** 按并发数把候选切成批次；顺序保持不变，批次内并发跑。 */
export function planBatches<T>(items: T[], concurrency = DEFAULT_CONCURRENCY): T[][] {
  const size = normalizeConcurrency(concurrency);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * 有界并发执行：所有任务同时排队，最多 `limit` 个在飞。
 * 为什么不用 Promise.all：8 个候选一次全开，mock 源没事，接真实 API 会直接被限流。
 * 结果按输入顺序返回，失败的用 `{ ok: false }` 占位，不中断其它候选。
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: string }>> {
  const size = normalizeConcurrency(limit);
  const results: Array<{ ok: true; value: R } | { ok: false; error: string }> = new Array(
    items.length,
  );
  let cursor = 0;

  async function pump(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index] as T;
      try {
        results[index] = { ok: true, value: await worker(item, index) };
      } catch (error) {
        results[index] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => pump()));
  return results;
}

/** 给子 Agent 的任务文本：一个候选、四个子问题，结果交给 submit_candidate。 */
export function buildResearchTask(task: ResearchTask): string {
  const { candidate: c } = task;
  return [
    `你是选品取证员。只负责这一个候选，不要评价其它商品，不要排序。`,
    ``,
    `候选：${c.title}`,
    `  asin=${c.asin}  category=${c.category}  marketplace=${c.marketplace}  priceUsd=${c.priceUsd}`,
    ``,
    `依次调用工具收集证据，不要自己编数字：`,
    `  1. keyword_metrics        → 需求与趋势，只传 asin`,
    `  2. competitor_snapshot    → 竞争格局，必须同时传 asin 和 title`,
    `  3. landed_cost            → 成本与利润`,
    `  4. compliance_check       → 合规风险`,
    `  5. submit_candidate       → 把下面这个对象作为参数交回，不要写进回复`,
    ``,
    `铁律：`,
    `- 数字只能来自工具返回；工具没给的就写 null 并记进 gaps，绝不猜。`,
    `- demand / trend / competition / margin 只抄工具返回的 scores。某个分数没返回就写 null，不要填 0，也不要自己换算。`,
    `- monthlyProfitUsd / monthlyUnits 只在 landed_cost 给了区间时照抄；没给就写 null。`,
    `- evidence 每条必须是 {claim, source, detail}，source 写成 "工具名:数据源名"，例如 keyword_metrics:mock:local-json。`,
    `- riskFlags 只能从这些值里选：侵权 / 认证缺失 / 危险品 / 食品接触 / 儿童用品 / 季节性过强 / 重量/体积过大 / 价格战；没有风险就给空数组。`,
    `- 字段只放进 submit_candidate 的参数。最终回复只能是两个字：完成。不要输出 JSON，不要复述证据。`,
    ``,
    `submit_candidate 的参数：`,
    `{"id":"${c.asin}","title":"${c.title}","category":"${c.category}","marketplace":"${c.marketplace}","priceUsd":${c.priceUsd},` +
      `"metrics":{"demand":null,"trend":null,"competition":null,"margin":null},` +
      `"monthlyProfitUsd":null,"monthlyUnits":null,` +
      `"riskFlags":[],"evidence":[{"claim":"","source":"","detail":""}]}`,
  ].join("\n");
}

/** 从子 Agent 的回复里抠出第一个完整 JSON 对象；抠不出返回 undefined。 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = fenced?.[1] ? [fenced[1]] : [];
  candidates.push(trimmed);

  for (const chunk of candidates) {
    const start = chunk.indexOf("{");
    const end = chunk.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    const slice = chunk.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // 继续尝试下一个候选片段：子 Agent 常在 JSON 前后加一句"完成"。
    }
  }
  return undefined;
}

export type ParseOutcome =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * 解析单个子 Agent 的回复。
 * 不做完整校验（那是 lib/schema.ts 的事），只保证拿到一个对象；
 * 缺字段的候选会由调用方交给 validateCandidates 统一判为不合格。
 */
export function parseChildReply(text: string): ParseOutcome {
  if (!text.trim()) return { ok: false, reason: "子 Agent 回复为空" };
  const parsed = extractJson(text);
  if (parsed === undefined) return { ok: false, reason: "回复里找不到 JSON 对象" };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "回复的 JSON 不是对象" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

type ToolCallLike = { name?: string; arguments?: unknown };

/** 从子会话里取出最后一次 submit_candidate 的参数。没有就返回 undefined。 */
export function submittedCandidate(
  messages: readonly { role?: string; toolCalls?: readonly ToolCallLike[] }[],
): Record<string, unknown> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const calls = message.toolCalls ?? [];
    for (let j = calls.length - 1; j >= 0; j--) {
      const call = calls[j];
      if (call?.name !== "submit_candidate") continue;
      const args = call.arguments;
      if (args && typeof args === "object" && !Array.isArray(args)) return args as Record<string, unknown>;
    }
  }
  return undefined;
}
