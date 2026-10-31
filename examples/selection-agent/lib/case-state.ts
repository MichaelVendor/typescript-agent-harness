import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INQUIRY_ITEMS, type PreparedCase } from "./prepare.ts";
import { PROJECT_ROOT } from "./report.ts";

export type CaseState = {
  /** 本轮选品站点。开场 set_marketplace 写入，整轮绑定。 */
  marketplace?: "DE" | "US";
  quote?: {
    purchasePrice?: number;
    moldFee?: number;
    moq?: number;
    cnyPerEur?: number;
    freightEur?: number;
    fbaFeeEur?: number;
    referralRate?: number;
  };
  sample?: Record<string, string>;
  listingConfirmed?: boolean;
  shelf?: { sku: string; title: string; priceEur: number; category: string };
  inquiry?: { asin: string; title: string; items: string[] };
};

const STATE_FILE = path.join(PROJECT_ROOT, "data", "case-state.json");

function amount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

function positive(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10000) / 10000;
}

function rate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return Math.round(value * 10000) / 10000;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 单件欧元利润。缺汇率、头程、尾程、佣金或目标价时返回 null，不补默认值。 */
export function quoteMargin(
  cost: { purchasePrice: number; cnyPerEur: number; freightEur: number; fbaFeeEur: number; referralRate: number },
  price: { min: number; max: number },
): NonNullable<PreparedCase["margin"]> {
  const purchaseEur = round4(cost.purchasePrice / cost.cnyPerEur);
  const at = (shelf: number) =>
    round4(shelf - purchaseEur - cost.freightEur - cost.fbaFeeEur - shelf * cost.referralRate);
  const lowProfit = at(price.min);
  const highProfit = at(price.max);
  return {
    purchaseEur,
    netProfitEur: { low: Math.min(lowProfit, highProfit), high: Math.max(lowProfit, highProfit) },
    netMargin: {
      low: round4(Math.min(lowProfit / price.min, highProfit / price.max)),
      high: round4(Math.max(lowProfit / price.min, highProfit / price.max)),
    },
    note: "按目标价区间和用户给出的汇率、头程、尾程、佣金计算。目标价不是已核实售价。没有月搜索量，不算月利润。",
  };
}

function units(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return value;
}

export function readCaseState(file = STATE_FILE): CaseState {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CaseState;
  } catch {
    return {};
  }
}

export function applyCaseState(prepared: PreparedCase, state: CaseState): PreparedCase {
  const purchasePrice = amount(state.quote?.purchasePrice);
  const moldFee = amount(state.quote?.moldFee);
  const moq = units(state.quote?.moq);
  const cnyPerEur = positive(state.quote?.cnyPerEur);
  const freightEur = amount(state.quote?.freightEur);
  const fbaFeeEur = amount(state.quote?.fbaFeeEur);
  const referralRate = rate(state.quote?.referralRate);
  const target = prepared.listing.priceTarget;
  const margin =
    purchasePrice !== null && cnyPerEur !== null && freightEur !== null && fbaFeeEur !== null && referralRate !== null && target
      ? quoteMargin(
          { purchasePrice, cnyPerEur, freightEur, fbaFeeEur, referralRate },
          { min: target.min, max: target.max },
        )
      : null;
  const checks = prepared.sample.checks.map((item) => {
    const result = state.sample?.[item.id]?.trim();
    return { ...item, result: result ? result : null };
  });
  const filled = checks.filter((item) => item.result).length;
  return {
    ...prepared,
    quote: {
      ...prepared.quote,
      purchasePrice,
      moldFee,
      moq,
      cnyPerEur,
      freightEur,
      fbaFeeEur,
      referralRate,
      status: purchasePrice !== null && moldFee !== null && moq !== null ? "已报价" : "待报价",
    },
    sample: {
      checks,
      status: filled === 0 ? "未试样" : filled === checks.length ? "已记录" : "部分记录",
    },
    listing: {
      ...prepared.listing,
      status: state.listingConfirmed === true ? "已确认" : "待确认",
    },
    margin,
    shelf: normalizeShelf(state.shelf),
    store: storeDraft(normalizeShelf(state.shelf), state.marketplace),
    inquiry: normalizeInquiry(state.inquiry),
    marketplace: state.marketplace ?? null,
  };
}

function normalizeInquiry(inquiry: CaseState["inquiry"]): PreparedCase["inquiry"] {
  if (!inquiry) return null;
  const asin = inquiry.asin.trim();
  const title = inquiry.title.trim();
  const items = inquiry.items.map((item) => item.trim()).filter(Boolean);
  if (!asin || !title || items.length === 0) return null;
  return { status: "已发起", asin, title, items };
}

/** 模拟店铺的固定说明。不生成税号、条码、件数或广告花费。 */
export function storeDraft(shelf: PreparedCase["shelf"], marketplace: CaseState["marketplace"] = readCaseState().marketplace): PreparedCase["store"] {
  if (!shelf) return null;
  const vatNote =
    marketplace === "US" ? "演示店铺，未登记真实美国销售税号" : "演示店铺，未登记真实德国 VAT";
  return {
    imageNote: "演示图，不是商品照片",
    germanTitle: shelf.title,
    germanNote: "标题用搜索页原文，没有另写卖点",
    gtin: `DEMO-${shelf.sku}`,
    gtinNote: "演示编码，不是 GS1 GTIN",
    vatNote,
    inboundNote: "演示已建单，件数未填，不会发往亚马逊仓库",
    adsNote: "未投放。没有预算，不创建广告",
  };
}

export function saveMarketplace(marketplace: "DE" | "US"): CaseState {
  const next = { ...readCaseState(), marketplace };
  writeState(next);
  // 选站闸门在 marketplace.ts 的 live 状态；这里只落盘给后台。
  return next;
}

function writeState(state: CaseState, file = STATE_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function publishCase(prepared: PreparedCase, root = PROJECT_ROOT): void {
  const file = path.join(root, "seller-backend", "case.json");
  writeFileSync(file, `${JSON.stringify(prepared, null, 2)}\n`);
}

export function saveQuote(input: {
  purchasePrice?: number;
  moldFee?: number;
  moq?: number;
  cnyPerEur?: number;
  freightEur?: number;
  fbaFeeEur?: number;
  referralRate?: number;
}): CaseState {
  const state = readCaseState();
  const quote = { ...state.quote };
  if (input.purchasePrice !== undefined) {
    const price = amount(input.purchasePrice);
    if (price === null) throw new Error("采购价必须是大于等于 0 的数字，单位人民币");
    quote.purchasePrice = price;
  }
  if (input.moldFee !== undefined) {
    const fee = amount(input.moldFee);
    if (fee === null) throw new Error("模费必须是大于等于 0 的数字，单位人民币");
    quote.moldFee = fee;
  }
  if (input.moq !== undefined) {
    const moq = units(input.moq);
    if (moq === null) throw new Error("起订量必须是正整数");
    quote.moq = moq;
  }
  if (input.cnyPerEur !== undefined) {
    const fx = positive(input.cnyPerEur);
    if (fx === null) throw new Error("汇率必须是大于 0 的数字，表示 1 欧元兑多少人民币");
    quote.cnyPerEur = fx;
  }
  if (input.freightEur !== undefined) {
    const freight = amount(input.freightEur);
    if (freight === null) throw new Error("头程必须是大于等于 0 的数字，单位欧元每件");
    quote.freightEur = freight;
  }
  if (input.fbaFeeEur !== undefined) {
    const fba = amount(input.fbaFeeEur);
    if (fba === null) throw new Error("尾程必须是大于等于 0 的数字，单位欧元每件");
    quote.fbaFeeEur = fba;
  }
  if (input.referralRate !== undefined) {
    const referral = rate(input.referralRate);
    if (referral === null) throw new Error("佣金必须是 0 到 1 的小数，例如 0.15");
    quote.referralRate = referral;
  }
  const recorded = [quote.purchasePrice, quote.moldFee, quote.moq, quote.cnyPerEur, quote.freightEur, quote.fbaFeeEur, quote.referralRate];
  if (recorded.every((item) => item === undefined)) throw new Error("至少记下一项报价或费用");
  const next = { ...state, quote };
  writeState(next);
  return next;
}

export function saveSample(results: { id: string; result: string }[], knownIds: string[]): CaseState {
  const allowed = new Set(knownIds);
  const state = readCaseState();
  const sample = { ...state.sample };
  if (results.length === 0) throw new Error("没有可记的试样结果");
  for (const item of results) {
    const id = item.id.trim();
    const result = item.result.trim();
    if (!allowed.has(id)) throw new Error(`没有编号 ${id} 的试样项`);
    if (!result) throw new Error(`编号 ${id} 的结果是空的`);
    sample[id] = result;
  }
  const next = { ...state, sample };
  writeState(next);
  return next;
}

function normalizeShelf(shelf: CaseState["shelf"]): PreparedCase["shelf"] {
  if (!shelf) return null;
  const sku = shelf.sku.trim();
  const title = shelf.title.trim();
  const category = shelf.category.trim();
  const priceEur = amount(shelf.priceEur);
  if (!sku || !title || !category || priceEur === null || priceEur <= 0) return null;
  return { sku, title, priceEur, category };
}

export function saveShelf(input: { sku: string; title: string; priceEur: number; category: string }): CaseState {
  const shelf = normalizeShelf(input);
  if (!shelf) throw new Error("上架对象需要 asin、标题、类目，以及大于 0 的欧元售价");
  const next = { ...readCaseState(), shelf };
  writeState(next);
  return next;
}

export function saveInquiry(input: { asin: string; title: string; items?: string[] }): CaseState {
  const asin = input.asin.trim();
  const title = input.title.trim();
  const items = (input.items?.length ? input.items : [...INQUIRY_ITEMS])
    .map((item) => item.trim())
    .filter(Boolean);
  if (!asin || !title) throw new Error("询盘需要 asin 和标题");
  if (items.length === 0) throw new Error("询盘清单不能为空");
  const next = { ...readCaseState(), inquiry: { asin, title, items } };
  writeState(next);
  return next;
}

export function confirmListing(): CaseState {
  const next = { ...readCaseState(), listingConfirmed: true };
  writeState(next);
  return next;
}
