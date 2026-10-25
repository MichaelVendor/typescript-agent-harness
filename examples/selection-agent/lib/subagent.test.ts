/**
 * 编排层的单测：切批、并发、解析子 Agent 回复。
 * 这些函数是纯的，不需要模型——并发编排最容易出错的恰恰是这里的边界。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchTask,
  extractJson,
  normalizeConcurrency,
  parseChildReply,
  submittedCandidate,
  planBatches,
  runWithConcurrency,
  type ProductRef,
} from "./subagent.ts";

const product: ProductRef = {
  asin: "B0TEST1234",
  title: "宠物慢食舔食垫",
  category: "Pet Supplies",
  marketplace: "US",
  priceUsd: 12.99,
};

test("normalizeConcurrency 把非法输入收敛到默认值", () => {
  assert.equal(normalizeConcurrency(undefined), 3);
  assert.equal(normalizeConcurrency(Number.NaN), 3);
  assert.equal(normalizeConcurrency("4"), 3);
  assert.equal(normalizeConcurrency(0), 1);
  assert.equal(normalizeConcurrency(-2), 1);
  assert.equal(normalizeConcurrency(2.7), 2);
  assert.equal(normalizeConcurrency(99), 8);
});

test("planBatches 按并发数切批且不丢、不乱序", () => {
  const items = ["a", "b", "c", "d", "e"];
  assert.deepEqual(planBatches(items, 2), [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(planBatches(items, 5), [items]);
  assert.deepEqual(planBatches(items, 8), [items]);
  assert.deepEqual(planBatches([], 3), []);
  const flat = planBatches(items, 2).flat();
  assert.deepEqual(flat, items);
});

test("runWithConcurrency 不超过并发上限，且按输入顺序返回", async () => {
  let inFlight = 0;
  let peak = 0;
  const result = await runWithConcurrency([10, 20, 30, 40, 50], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, n === 10 ? 12 : 2));
    inFlight -= 1;
    return n * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(
    result.map((r) => (r.ok ? r.value : r.error)),
    [20, 40, 60, 80, 100],
  );
});

test("runWithConcurrency 单个任务失败不影响其它任务", async () => {
  const result = await runWithConcurrency([1, 2, 3], 3, async (n) => {
    if (n === 2) throw new Error("boom");
    return n;
  });
  assert.equal(result[0]!.ok, true);
  assert.equal(result[1]!.ok, false);
  assert.equal(result[1]!.ok === false && result[1]!.error, "boom");
  assert.equal(result[2]!.ok, true);
});

test("buildResearchTask 带上候选信息、四个工具和 JSON 骨架", () => {
  const task = buildResearchTask({ batch: 1, candidate: product });
  for (const piece of ["B0TEST1234", "宠物慢食舔食垫", "US", "keyword_metrics", "competitor_snapshot", "landed_cost", "compliance_check", "submit_candidate", "完成"]) {
    assert.ok(task.includes(piece), `任务里应包含 ${piece}`);
  }
  // 子 Agent 也必须有"数字只能来自工具"这条，不然它会拿标题瞎编指标。
  assert.ok(task.includes("绝不猜"));
  assert.ok(task.includes('"metrics"'));
});

test("extractJson 能从代码块、裸 JSON、带前后缀的回复里抠出对象", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('好的，完成：\n{"a":1}\n以上。'), { a: 1 });
  assert.deepEqual(extractJson('```\n{"a":{"b":[1,2]}}\n```'), { a: { b: [1, 2] } });
  assert.equal(extractJson("没有 JSON"), undefined);
  assert.equal(extractJson(""), undefined);
});

test("parseChildReply 区分空回复、非 JSON、数组和非对象", () => {
  assert.equal(parseChildReply("  ").ok, false);
  assert.equal(parseChildReply("抱歉，我无法完成").ok, false);
  const arrayReply = parseChildReply("[1,2]");
  assert.equal(arrayReply.ok, false);
  const ok = parseChildReply('```json\n{"id":"B0TEST1234","metrics":{"demand":0.5}}\n```');
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.value.id, "B0TEST1234");
});

test("submittedCandidate 取最后一次交卷参数", () => {
  const found = submittedCandidate([
    { role: "assistant", toolCalls: [{ name: "keyword_metrics", arguments: { asin: "B0" } }] },
    { role: "assistant", toolCalls: [{ name: "submit_candidate", arguments: { id: "B0TEST1234", metrics: { demand: null } } }] },
    { role: "assistant" },
  ]);
  assert.equal(found?.id, "B0TEST1234");
  assert.equal(submittedCandidate([{ role: "assistant" }]), undefined);
});
