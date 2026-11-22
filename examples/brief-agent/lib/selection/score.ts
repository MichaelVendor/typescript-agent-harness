/**
 * 打分模型 —— 纯函数，不读文件、不调模型、不发网络请求。
 *
 * 为什么必须在这里：分数要能复算、能回测、能调权重。如果让模型"心算总分"，
 * 同一批候选换一次对话就会得到不同排名，而且没法解释差异。
 * 模型只负责填 0–1 的结构化字段和证据，加减乘除在这里做。
 */

import { CAP_RISK_FLAGS, type Candidate, type Range } from "./schema.ts";

export const WEIGHTS = {
  demand: 0.3,
  trend: 0.2,
  competition: 0.25,
  margin: 0.25,
} as const;

export type Weights = { [K in keyof typeof WEIGHTS]: number };

/** 证据少于这个数量就算"证据不足"。 */
export const MIN_EVIDENCE = 3;
/** 证据充足时的置信度。 */
export const CONFIDENT = 1;
/** 证据不足时的置信度。 */
export const UNDER_EVIDENCED = 0.6;
/** 命中封顶风险时总分的上限。 */
export const RISK_CAP = 0.3;

export type Action = "上架" | "观察" | "放弃";

export type Breakdown = {
  demand: number;
  trend: number;
  competition: number;
  margin: number;
};

export type Scored = {
  id: string;
  title: string;
  category: string;
  /** 加权原始分 0–1（未封顶、未降权）。 */
  raw: number;
  breakdown: Breakdown;
  /** 风险封顶系数：命中侵权/认证缺失为 RISK_CAP，否则 1。 */
  cap: number;
  /** 证据置信度：证据 >= 3 条为 1，否则 0.6。 */
  confidence: number;
  /** raw * cap * confidence，四舍五入到 4 位。 */
  total: number;
  riskFlags: string[];
  evidenceCount: number;
  /** 为了达到满分还缺哪些证据维度，供模型在报告里写"下一步要验什么"。 */
  gaps: string[];
  action: Action;
  reasons: string[];
};

const round = (n: number, digits = 4): number =>
  Math.round(n * 10 ** digits) / 10 ** digits;

/** 各维度的解释文案用阈值判定，避免把解释权交给模型。 */
function label(score: number, tiers: [number, string][]): string | undefined {
  return tiers.find(([min]) => score >= min)?.[1];
}

const DEMAND_TIERS: [number, string][] = [
  [0.8, "需求大"],
  [0.5, "需求中等"],
];
const TREND_TIERS: [number, string][] = [
  [0.65, "趋势上行"],
  [0, "趋势平淡或下行"],
];
const COMPETITION_TIERS: [number, string][] = [
  [0.6, "竞争相对松"],
  [0, "竞争激烈"],
];
const MARGIN_TIERS: [number, string][] = [
  [0.7, "利润空间好"],
  [0.4, "利润一般"],
  [0, "利润薄"],
];

/** 总分 → 建议动作。只有三档，且风险商品不许进「上架」。 */
export function decideAction(total: number, cap: number): Action {
  if (total >= 0.65 && cap === 1) return "上架";
  if (total >= 0.45) return "观察";
  return "放弃";
}

/** 缺口：证据维度覆盖不全时提示补证据。 */
function gapsOf(candidate: Candidate): string[] {
  const sources = new Set(candidate.evidence.map((e) => e.source.split(":")[0]));
  const need: [string, string][] = [
    ["keyword_metrics", "需求/趋势证据"],
    ["competitor_snapshot", "竞品证据"],
    ["landed_cost", "利润测算证据"],
    ["compliance_check", "合规证据"],
  ];
  const gaps = need.filter(([tool]) => !sources.has(tool)).map(([, gap]) => gap);
  if (!gaps.length) return [];
  return gaps;
}

const METRIC_GAPS = {
  demand: "需求（无月搜索量）",
  trend: "趋势（无近 3 个月搜索序列）",
  competition: "竞争",
  margin: "利润（无采购成本）",
} as const;

export function scoreCandidate(candidate: Candidate, weights: Weights = WEIGHTS): Scored {
  const { metrics } = candidate;
  const dims = ["demand", "trend", "competition", "margin"] as const;
  const missing = dims.filter((key) => metrics[key] == null).map((key) => METRIC_GAPS[key]);
  let presentWeight = 0;
  let weighted = 0;
  for (const key of dims) {
    const value = metrics[key];
    if (value == null) continue;
    presentWeight += weights[key];
    weighted += value * weights[key];
  }
  const scale = presentWeight > 0 ? 1 / presentWeight : 0;
  const breakdown: Breakdown = {
    demand: metrics.demand == null ? 0 : round(metrics.demand * weights.demand * scale),
    trend: metrics.trend == null ? 0 : round(metrics.trend * weights.trend * scale),
    competition: metrics.competition == null ? 0 : round(metrics.competition * weights.competition * scale),
    margin: metrics.margin == null ? 0 : round(metrics.margin * weights.margin * scale),
  };
  const raw = presentWeight > 0 ? round(weighted * scale) : 0;

  const capped = candidate.riskFlags.filter((f) => CAP_RISK_FLAGS.includes(f));
  const cap = capped.length > 0 ? RISK_CAP : 1;
  const thinEvidence = candidate.evidence.length < MIN_EVIDENCE;
  const confidence = missing.length > 0 || thinEvidence ? UNDER_EVIDENCED : CONFIDENT;
  const total = round(raw * cap * confidence);

  const reasons = [
    metrics.demand == null ? undefined : label(metrics.demand, DEMAND_TIERS),
    metrics.trend == null ? undefined : label(metrics.trend, TREND_TIERS),
    metrics.competition == null ? undefined : label(metrics.competition, COMPETITION_TIERS),
    metrics.margin == null ? undefined : label(metrics.margin, MARGIN_TIERS),
  ].filter((r): r is string => Boolean(r));
  if (capped.length > 0) reasons.push(`风险封顶（${capped.join("、")}）：总分上限 ${RISK_CAP}`);
  if (missing.length > 0) {
    reasons.push(`缺数据（${missing.join("、")}），只按已有维度计分，置信度 ${UNDER_EVIDENCED}，不能上架`);
  } else if (thinEvidence) {
    reasons.push(`证据 ${candidate.evidence.length} 条 < ${MIN_EVIDENCE} 条，置信度降为 ${UNDER_EVIDENCED}`);
  }

  return {
    id: candidate.id,
    title: candidate.title,
    category: candidate.category,
    raw,
    breakdown,
    cap,
    confidence,
    total,
    riskFlags: [...candidate.riskFlags],
    evidenceCount: candidate.evidence.length,
    gaps: [...gapsOf(candidate), ...missing],
    action: decideAction(total, cap),
    reasons,
  };
}

/** 降序排列；同分按 id 稳定排序，保证两次运行结果一致。 */
export function rankCandidates(candidates: Candidate[], weights: Weights = WEIGHTS): Scored[] {
  return candidates
    .map((c) => scoreCandidate(c, weights))
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}

/**
 * 规范化权重：总和不为 1 时按比例缩放，并四舍五入。
 * 调权重是产品决策，不允许悄悄发生——所以这里返回实际使用的权重，调用方要回显。
 */
export function normalizeWeights(weights: Partial<Weights>): Weights {
  const merged: Weights = { ...WEIGHTS, ...weights };
  const sum = merged.demand + merged.trend + merged.competition + merged.margin;
  if (sum <= 0) throw new Error("权重之和必须为正");
  return {
    demand: round(merged.demand / sum),
    trend: round(merged.trend / sum),
    competition: round(merged.competition / sum),
    margin: round(merged.margin / sum),
  };
}

const BAR_CELLS = 8;

/** 数字后面跟一条 8 格的方块，满格对应该维度的权重；总分满格是 1。 */
function meter(value: number, full: number): string {
  const ratio = full > 0 ? value / full : 0;
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(ratio * BAR_CELLS)));
  return `${value.toFixed(3)} ${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}`;
}

/** 排序结果转 markdown 表，主 Agent 直接把这段话贴给用户即可。images 的 key 是候选 id。 */
export function toMarkdownTable(rows: Scored[], images: Readonly<Record<string, string>> = {}): string {
  const header =
    "| 排名 | 图片 | 商品 | 总分 | 需求 | 趋势 | 竞争 | 利润 | 置信度 | 风险 | 建议动作 |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const dim = (value: number, gaps: string[], label: string, full: number) =>
    gaps.includes(label) ? "—" : meter(value, full);
  const picture = (id: string) => {
    const url = images[id];
    return url ? `![](${url})` : "—";
  };
  const body = rows.map((r, i) =>
    [
      i + 1,
      picture(r.id),
      r.title,
      meter(r.total, 1),
      dim(r.breakdown.demand, r.gaps, "需求（无月搜索量）", WEIGHTS.demand),
      dim(r.breakdown.trend, r.gaps, "趋势（无近 3 个月搜索序列）", WEIGHTS.trend),
      dim(r.breakdown.competition, r.gaps, "竞争", WEIGHTS.competition),
      dim(r.breakdown.margin, r.gaps, "利润（无采购成本）", WEIGHTS.margin),
      r.confidence.toFixed(2),
      r.riskFlags.length ? r.riskFlags.join("、") : "—",
      r.action === "上架" ? "**上架**" : r.action,
    ].join(" | "),
  );
  return [header, ...body.map((cells) => `| ${cells} |`)].join("\n");
}

/** 区间加总：利润率/销量这类区间字段上报时使用。 */
export function sumRanges(ranges: Range[]): Range {
  return ranges.reduce<Range>(
    (acc, r) => ({ low: acc.low + r.low, mid: acc.mid + r.mid, high: acc.high + r.high }),
    { low: 0, mid: 0, high: 0 },
  );
}
