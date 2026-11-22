/**
 * 归一化：把原始指标换算成 0–1 的打分输入。
 *
 * 放在 lib 里而不是交给模型，是为了让"搜索量 74000 应该算需求多高"
 * 这件事可复算、可回测——同一批数据，昨天和今天的换算必须一致。
 * AGENTS.md 里给模型的换算表以此处为准。
 */

/** 分段线性插值：points 必须按 x 升序。 */
export function piecewise(x: number, points: [number, number][]): number {
  if (!Number.isFinite(x) || points.length === 0) return 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x0, y0] = points[i - 1]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/** 月搜索量 → 需求分。5k≈0.2，20k≈0.5，60k≈0.8，100k+≈0.95。 */
export const DEMAND_POINTS: [number, number][] = [
  [0, 0],
  [5_000, 0.2],
  [20_000, 0.5],
  [60_000, 0.8],
  [100_000, 0.95],
];

/** 近 3 个月变化率 → 趋势分。下行给低分，上行给高分；季节性强的另用 seasonal 提示。 */
export function trendScore(trend3m: number): number {
  return piecewise(trend3m, [
    [-0.3, 0.05],
    [-0.1, 0.3],
    [0, 0.5],
    [0.1, 0.7],
    [0.25, 0.9],
    [0.5, 0.95],
  ]);
}

/**
 * 竞争 → 0–1（越大越不卷）：Top10 中评论数 <200 的占比 × 0.6 + (1 − 头部品牌集中度) × 0.4。
 * 与 AGENTS.md 的换算表一致。
 */
export function competitionScore(lowReviewShare: number, brandConcentration: number): number {
  const a = Math.min(Math.max(lowReviewShare, 0), 1);
  const b = 1 - Math.min(Math.max(brandConcentration, 0), 1);
  return round(a * 0.6 + b * 0.4);
}

/** 净利率 → 利润分。10%≈0.3，20%≈0.55，30%≈0.75，40%+≈0.9。 */
export const MARGIN_POINTS: [number, number][] = [
  [0, 0],
  [0.1, 0.3],
  [0.2, 0.55],
  [0.3, 0.75],
  [0.4, 0.9],
];

export function marginScore(netMargin: number): number {
  return piecewise(netMargin, MARGIN_POINTS);
}

/** 搜索量序列的季节性强度：月度最高/最低比，> 2.5 视为季节性过强。 */
export function seasonalityRatio(series: number[]): number {
  const positive = series.filter((n) => n > 0);
  if (positive.length < 2) return 1;
  return round(Math.max(...positive) / Math.min(...positive));
}

/** 月销量粗估：搜索量 × 转化率区间（类目经验值，抓数据后应替换）。 */
export function unitEstimate(monthlySearchVolume: number): { low: number; mid: number; high: number } {
  const conv = { low: 0.015, mid: 0.03, high: 0.05 };
  const scale = monthlySearchVolume;
  return {
    low: Math.round(scale * conv.low),
    mid: Math.round(scale * conv.mid),
    high: Math.round(scale * conv.high),
  };
}

function round(n: number, digits = 4): number {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}
