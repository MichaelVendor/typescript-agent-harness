/**
 * 候选商品的结构化字段。
 *
 * 这里刻意**不引入 zod 之类的外部依赖**：convention 项目通过 jiti 直接加载
 * .ts，少一个依赖就少一次安装失败。校验写成手写谓词，返回错误列表而不是抛异常，
 * 这样工具可以把"哪几个候选不合格"原样交回给模型去补，而不是让整轮 turn 崩掉。
 */

/** 分数区间：不给点值，避免过度自信。 */
export type Range = { low: number; mid: number; high: number };

export type RiskFlag =
  | "侵权"
  | "认证缺失"
  | "危险品"
  | "食品接触"
  | "儿童用品"
  | "季节性过强"
  | "重量/体积过大"
  | "价格战";

export const RISK_FLAGS: readonly RiskFlag[] = [
  "侵权",
  "认证缺失",
  "危险品",
  "食品接触",
  "儿童用品",
  "季节性过强",
  "重量/体积过大",
  "价格战",
];

/** 判定为"高置信度风险"的标记：命中即封顶。 */
export const CAP_RISK_FLAGS: readonly RiskFlag[] = ["侵权", "认证缺失"];

export type Evidence = {
  /** 一句话事实，必须来自工具返回。 */
  claim: string;
  /** 证据来源：工具名或数据源名，例如 keyword_metrics / mock:keywords。 */
  source: string;
  /** 可复核的数值或链接。 */
  detail: string;
};

export type Metrics = {
  /** 0–1，越大越好。工具没给时为 null，不要填 0。 */
  demand: number | null;
  trend: number | null;
  /** 0–1，越大越"不卷"。 */
  competition: number | null;
  /** 0–1，0.5 约等于净利率 20%。 */
  margin: number | null;
};

export type Candidate = {
  /** 稳定 id，落盘和复算都靠它。 */
  id: string;
  title: string;
  category: string;
  marketplace: string;
  /** 建议零售价，USD。 */
  priceUsd: number;
  metrics: Metrics;
  /** 月利润区间，USD。工具没给时为 null。 */
  monthlyProfitUsd: Range | null;
  /** 月销量区间，件。工具没给时为 null。 */
  monthlyUnits: Range | null;
  riskFlags: RiskFlag[];
  evidence: Evidence[];
};

export type Problem = { path: string; message: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isUnit = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** 没给区间，或给了一个空对象。这是缺数据，不是不合格。 */
function absentRange(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isObject(value)) return false;
  const { low, mid, high } = value;
  return [low, mid, high].every((n) => n === undefined || n === null);
}

function checkRange(value: unknown, path: string, problems: Problem[]): void {
  if (value === null) return;
  if (!isObject(value)) {
    problems.push({ path, message: "必须是 { low, mid, high }" });
    return;
  }
  const { low, mid, high } = value;
  if (![low, mid, high].every((n) => typeof n === "number" && Number.isFinite(n))) {
    problems.push({ path, message: "low/mid/high 必须是有限数字" });
    return;
  }
  const r = value as unknown as Range;
  if (!(r.low <= r.mid && r.mid <= r.high)) {
    problems.push({ path, message: `区间必须满足 low<=mid<=high，收到 ${r.low}/${r.mid}/${r.high}` });
  }
  if (r.low < 0) problems.push({ path, message: "low 不能为负" });
}

/**
 * 校验一个候选；返回空数组表示合格。
 * 只做"结构 + 明显越界"的检查，业务判断留给模型，规则约束留给 score.ts。
 */
export function validateCandidate(input: unknown): Problem[] {
  const problems: Problem[] = [];
  if (!isObject(input)) return [{ path: "", message: "候选必须是对象" }];

  for (const key of ["id", "title", "category", "marketplace"] as const) {
    if (typeof input[key] !== "string" || input[key].length === 0) {
      problems.push({ path: key, message: "必须是非空字符串" });
    }
  }
  if (typeof input.priceUsd !== "number" || !(input.priceUsd > 0)) {
    problems.push({ path: "priceUsd", message: "必须是正数（USD）" });
  }

  if (!isObject(input.metrics)) {
    problems.push({ path: "metrics", message: "缺少 metrics" });
  } else {
    for (const key of ["demand", "trend", "competition", "margin"] as const) {
      if (input.metrics[key] !== null && !isUnit(input.metrics[key])) {
        problems.push({ path: `metrics.${key}`, message: "必须是 0–1 之间的数字，没有数据就传 null" });
      }
    }
  }

  if (absentRange(input.monthlyProfitUsd)) input.monthlyProfitUsd = null;
  if (absentRange(input.monthlyUnits)) input.monthlyUnits = null;
  checkRange(input.monthlyProfitUsd, "monthlyProfitUsd", problems);
  checkRange(input.monthlyUnits, "monthlyUnits", problems);

  if (!Array.isArray(input.riskFlags)) {
    problems.push({ path: "riskFlags", message: "必须是数组（没有风险就传空数组）" });
  } else {
    for (const [i, flag] of input.riskFlags.entries()) {
      if (typeof flag !== "string" || !RISK_FLAGS.includes(flag as RiskFlag)) {
        problems.push({
          path: `riskFlags[${i}]`,
          message: `未知风险标记 "${String(flag)}"，可用值：${RISK_FLAGS.join(" / ")}`,
        });
      }
    }
  }

  if (!Array.isArray(input.evidence)) {
    problems.push({ path: "evidence", message: "必须是数组" });
  } else {
    for (const [i, item] of input.evidence.entries()) {
      if (!isObject(item)) {
        problems.push({ path: `evidence[${i}]`, message: "必须是 { claim, source, detail }" });
        continue;
      }
      for (const key of ["claim", "source", "detail"] as const) {
        if (typeof item[key] !== "string" || item[key].length === 0) {
          problems.push({ path: `evidence[${i}].${key}`, message: "必须是非空字符串" });
        }
      }
    }
  }

  return problems;
}

/** 校验一批候选，附带每个候选的合格与否；工具直接把 problems 回给模型。 */
export function validateCandidates(inputs: unknown[]): {
  ok: Candidate[];
  rejected: { index: number; problems: Problem[] }[];
} {
  const ok: Candidate[] = [];
  const rejected: { index: number; problems: Problem[] }[] = [];
  for (const [index, input] of inputs.entries()) {
    const problems = validateCandidate(input);
    if (problems.length === 0) ok.push(input as Candidate);
    else rejected.push({ index, problems });
  }
  return { ok, rejected };
}
