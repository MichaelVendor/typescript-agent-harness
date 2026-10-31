import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIDENT,
  RISK_CAP,
  UNDER_EVIDENCED,
  decideAction,
  normalizeWeights,
  rankCandidates,
  scoreCandidate,
  sumRanges,
  toMarkdownTable,
  WEIGHTS,
} from "./score.ts";
import { validateCandidate } from "./schema.ts";
import type { Candidate } from "./schema.ts";

const base: Candidate = {
  id: "B0TEST01",
  title: "测试商品",
  category: "outdoor",
  marketplace: "US",
  priceUsd: 29.99,
  metrics: { demand: 0.8, trend: 0.7, competition: 0.5, margin: 0.6 },
  monthlyProfitUsd: { low: 800, mid: 1200, high: 1600 },
  monthlyUnits: { low: 100, mid: 200, high: 300 },
  riskFlags: [],
  evidence: [
    { claim: "月搜索量 74000", source: "keyword_metrics:mock:local-json", detail: "monthlySearchVolume=74000" },
    { claim: "Top10 低评论占比 0.3", source: "competitor_snapshot:mock:local-json", detail: "lowReviewShare=0.3" },
    { claim: "净利率 22%", source: "landed_cost:mock:local-json", detail: "netMargin=0.22" },
  ],
};

test("加权总分 = 各维度 × 权重", () => {
  const s = scoreCandidate(base);
  const expected = 0.8 * WEIGHTS.demand + 0.7 * WEIGHTS.trend + 0.5 * WEIGHTS.competition + 0.6 * WEIGHTS.margin;
  assert.equal(s.raw, Math.round(expected * 1e4) / 1e4);
  assert.equal(s.cap, 1);
  assert.equal(s.confidence, CONFIDENT);
  assert.equal(s.total, s.raw);
});

test("零数据不崩、分数为 0", () => {
  const s = scoreCandidate({
    ...base,
    metrics: { demand: 0, trend: 0, competition: 0, margin: 0 },
    evidence: [],
    riskFlags: [],
  });
  assert.equal(s.raw, 0);
  assert.equal(s.total, 0);
  assert.equal(s.confidence, UNDER_EVIDENCED);
  assert.equal(s.action, "放弃");
  assert.equal(s.gaps.length, 4, "四个证据维度全缺");
});

test("侵权 / 认证缺失 触发封顶 0.3，且不许上架", () => {
  const hot: Candidate = {
    ...base,
    metrics: { demand: 1, trend: 1, competition: 1, margin: 1 },
    riskFlags: ["侵权"],
  };
  const s = scoreCandidate(hot);
  assert.equal(s.raw, 1);
  assert.equal(s.cap, RISK_CAP);
  assert.equal(s.total, RISK_CAP);
  assert.notEqual(s.action, "上架", "封顶商品不能建议上架");
  assert.ok(s.reasons.some((r) => r.includes("封顶")));
});

test("非封顶风险（如价格战）不影响总分", () => {
  const s = scoreCandidate({ ...base, riskFlags: ["价格战", "季节性过强"] });
  assert.equal(s.cap, 1);
  assert.equal(s.total, s.raw);
});

test("缺维度只按已有权重计分，且置信度降到 0.6", () => {
  const s = scoreCandidate({
    ...base,
    metrics: { demand: null, trend: null, competition: 0.8, margin: null },
  });
  assert.equal(s.raw, 0.8);
  assert.equal(s.confidence, UNDER_EVIDENCED);
  assert.equal(s.total, 0.48);
  assert.equal(s.action, "观察");
  assert.ok(s.gaps.some((gap) => gap.includes("需求")));
});

test("证据不足降权 0.6：恰好 3 条为满置信度，2 条为 0.6", () => {
  const at = (n: number) => scoreCandidate({ ...base, evidence: base.evidence.slice(0, n) });
  assert.equal(at(3).confidence, CONFIDENT);
  assert.equal(at(2).confidence, UNDER_EVIDENCED);
  assert.equal(at(2).total, Math.round(at(2).raw * UNDER_EVIDENCED * 1e4) / 1e4);
});

test("动作阈值与封顶交互", () => {
  assert.equal(decideAction(0.66, 1), "上架");
  assert.equal(decideAction(0.66, RISK_CAP), "观察");
  assert.equal(decideAction(0.5, 1), "观察");
  assert.equal(decideAction(0.44, 1), "放弃");
});

test("排序稳定：同分按 id 升序，两次运行结果一致", () => {
  const a: Candidate = { ...base, id: "B0AAA", metrics: { ...base.metrics } };
  const b: Candidate = { ...base, id: "B0BBB", metrics: { ...base.metrics } };
  const first = rankCandidates([b, a]).map((r) => r.id);
  const second = rankCandidates([a, b]).map((r) => r.id);
  assert.deepEqual(first, ["B0AAA", "B0BBB"]);
  assert.deepEqual(first, second);
});

test("权重归一化：总和不为 1 时按比例缩放", () => {
  const w = normalizeWeights({ demand: 2, trend: 2, competition: 2, margin: 2 });
  assert.equal(w.demand + w.trend + w.competition + w.margin, 1);
  assert.equal(w.margin, 0.25);
  assert.throws(() => normalizeWeights({ demand: 0, trend: 0, competition: 0, margin: 0 }));
});

test("区间相加保持 low<=mid<=high", () => {
  const r = sumRanges([
    { low: 1, mid: 2, high: 3 },
    { low: 10, mid: 20, high: 40 },
  ]);
  assert.deepEqual(r, { low: 11, mid: 22, high: 43 });
});

test("schema 校验拦住越界分数、缺失证据和未知风险标记", () => {
  const bad = validateCandidate({
    ...base,
    metrics: { ...base.metrics, demand: 1.4 },
    evidence: [{ claim: "x" }],
    riskFlags: ["看心情"],
  });
  const paths = bad.map((p) => p.path);
  assert.ok(paths.includes("metrics.demand"));
  assert.ok(paths.includes("evidence[0].source"));
  assert.ok(paths.includes("riskFlags[0]"));

  assert.deepEqual(validateCandidate(base), [], "合法候选不应报错");
});

test("排行榜表带图片列，没有图的格子是破折号", () => {
  const row = scoreCandidate(base);
  const url = "https://m.media-amazon.com/images/I/abc.jpg";
  const withImage = toMarkdownTable([row], { B0TEST01: url });
  assert.match(withImage, /\| 图片 \|/);
  assert.match(withImage, /\| 1 \| !\[\]\(https:\/\/m\.media-amazon\.com\/images\/I\/abc\.jpg\) \| 测试商品 \|/);
  assert.match(withImage, /0\.655 █████░░░/);
  assert.match(withImage, /0\.240 ██████░░/);
  assert.match(withImage, /\*\*上架\*\*/);
  const blank = toMarkdownTable([row]);
  assert.match(blank, /\| 1 \| — \| 测试商品 \|/);
});

test("schema 拦住倒挂区间", () => {
  const bad = validateCandidate({ ...base, monthlyProfitUsd: { low: 2000, mid: 1200, high: 1600 } });
  assert.ok(bad.some((p) => p.path === "monthlyProfitUsd"));
});

test("利润和月销量缺了就当 null，不退回候选", () => {
  const omitted = { ...base } as Partial<Candidate>;
  delete omitted.monthlyProfitUsd;
  delete omitted.monthlyUnits;
  assert.deepEqual(validateCandidate(omitted), []);
  assert.equal(omitted.monthlyProfitUsd, null);
  assert.equal(omitted.monthlyUnits, null);
  const empty = validateCandidate({ ...base, monthlyProfitUsd: {}, monthlyUnits: {} });
  assert.deepEqual(empty, []);
});
