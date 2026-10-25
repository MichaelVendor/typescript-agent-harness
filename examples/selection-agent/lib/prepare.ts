import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyCaseState, readCaseState } from "./case-state.ts";

export type PreparedCase = {
  spu: string;
  name: string;
  quote: {
    status: "待报价" | "已报价";
    purchasePrice: number | null;
    moldFee: number | null;
    moq: number | null;
    currency: "CNY";
    cnyPerEur: number | null;
    freightEur: number | null;
    fbaFeeEur: number | null;
    referralRate: number | null;
    ask: string[];
    note: string;
  };
  sample: {
    status: "未试样" | "部分记录" | "已记录";
    checks: { id: string; gate: string; result: string | null }[];
  };
  listing: {
    status: "待确认" | "已确认";
    title: string;
    bullets: string[];
    priceTarget: { min: number; max: number; currency: "EUR"; note: string } | null;
  };
  /** 采购价、汇率、头程、尾程、佣金和目标价都在时才有。月销量不在这里算。 */
  margin: {
    purchaseEur: number;
    netProfitEur: { low: number; high: number };
    netMargin: { low: number; high: number };
    note: string;
  } | null;
  /** 用户从排行榜点中的上架对象。没有点过就是 null，不默认成档案提案。 */
  shelf: { sku: string; title: string; priceEur: number; category: string } | null;
  /** 模拟店铺随上架带上的说明。没有选中商品时是 null。 */
  store: {
    imageNote: string;
    germanTitle: string;
    germanNote: string;
    gtin: string;
    gtinNote: string;
    vatNote: string;
    inboundNote: string;
    adsNote: string;
  } | null;
};

type Plan = {
  differentiation?: string;
  validation_plan?: string;
  cost_evidence?: string;
  target_price_min?: string | null;
  target_price_max?: string | null;
  sale_currency?: string | null;
};

type Raw = {
  spu?: string;
  proposal?: {
    proposal_name?: string;
    source_snapshot?: { plan?: Plan };
  };
};

const ASK = ["硅胶净重", "成型与后处理", "检验", "包材", "起订量", "模费与摊销"];

function money(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** 档案验证方案按「1）2）」切开，每条只留第一句，不补实测。 */
export function sampleChecks(text: string): { id: string; gate: string; result: null }[] {
  return text
    .split(/\d+）/)
    .slice(1)
    .map((part, index) => {
      const gate = part.split("。")[0]?.replace(/\s+/g, " ").trim() ?? "";
      return { id: String(index + 1), gate, result: null };
    })
    .filter((item) => item.gate.length > 0);
}

export function prepareCase(raw: Raw): PreparedCase {
  const plan = raw.proposal?.source_snapshot?.plan ?? {};
  const min = money(plan.target_price_min);
  const max = money(plan.target_price_max);
  const bullets = (plan.differentiation ?? "")
    .split("。")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    spu: raw.spu || "DE2610221",
    name: raw.proposal?.proposal_name || "",
    quote: {
      status: "待报价",
      purchasePrice: null,
      moldFee: null,
      moq: null,
      currency: "CNY",
      cnyPerEur: null,
      freightEur: null,
      fbaFeeEur: null,
      referralRate: null,
      ask: ASK,
      note: plan.cost_evidence?.trim() || "档案没有已核实采购价。",
    },
    sample: {
      status: "未试样",
      checks: sampleChecks(plan.validation_plan ?? ""),
    },
    listing: {
      status: "待确认",
      title: raw.proposal?.proposal_name || "",
      bullets,
      priceTarget:
        min !== null && max !== null
          ? {
              min,
              max,
              currency: "EUR",
              note: "待验证目标价，不是已核实售价，也不是采购价。",
            }
          : null,
    },
    margin: null,
    shelf: null,
    store: null,
  };
}

export function loadPreparedCase(): PreparedCase {
  const file = fileURLToPath(new URL("../data/DE2610221.json", import.meta.url));
  return applyCaseState(prepareCase(JSON.parse(readFileSync(file, "utf8")) as Raw), readCaseState());
}
