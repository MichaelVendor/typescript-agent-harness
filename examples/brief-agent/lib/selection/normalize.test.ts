import assert from "node:assert/strict";
import { test } from "node:test";
import {
  competitionScore,
  marginScore,
  piecewise,
  seasonalityRatio,
  trendScore,
  unitEstimate,
} from "./normalize.ts";

test("分段插值在断点与区间内都正确", () => {
  const points: [number, number][] = [
    [0, 0],
    [10, 1],
  ];
  assert.equal(piecewise(-5, points), 0, "低于下界取下界值");
  assert.equal(piecewise(0, points), 0);
  assert.equal(piecewise(5, points), 0.5);
  assert.equal(piecewise(10, points), 1);
  assert.equal(piecewise(99, points), 1, "高于上界取上界值");
  assert.equal(piecewise(Number.NaN, points), 0);
});

test("趋势分随变化率单调上升", () => {
  const values = [-0.5, -0.2, 0, 0.1, 0.3, 0.8].map(trendScore);
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i]! >= values[i - 1]!, "趋势分必须单调不减");
  }
  assert.ok(trendScore(0.2) > 0.75);
  assert.ok(trendScore(-0.2) < 0.25);
});

test("竞争分：低评论占比高 + 品牌分散 = 不卷", () => {
  assert.equal(competitionScore(1, 0), 1);
  assert.equal(competitionScore(0, 1), 0);
  assert.equal(competitionScore(0.3, 0.62), 0.332);
  // 越界输入被夹住而不是算出负数
  assert.equal(competitionScore(-1, 2), 0);
});

test("利润分：15% 净利率低于 0.5 的良品线", () => {
  assert.equal(marginScore(0), 0);
  assert.ok(marginScore(0.15) < 0.5);
  assert.ok(marginScore(0.22) > 0.55);
  assert.equal(marginScore(0.6), 0.9, "超过断点取平台值");
});

test("季节性：强弱判定用 max/min 比", () => {
  assert.equal(seasonalityRatio([100, 100, 100]), 1);
  assert.equal(seasonalityRatio([100, 300]), 3);
  assert.equal(seasonalityRatio([0, 100]), 1, "0 值不参与，避免除零");
  assert.equal(seasonalityRatio([]), 1);
});

test("月销量区间保证 low<=mid<=high 且不为负", () => {
  for (const v of [0, 1000, 74000, 120000]) {
    const r = unitEstimate(v);
    assert.ok(r.low <= r.mid && r.mid <= r.high);
    assert.ok(r.low >= 0);
  }
});
