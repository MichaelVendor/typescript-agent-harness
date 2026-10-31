import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LandedCost } from "./sources/types.ts";

const file = fileURLToPath(new URL("../data/demo-margin.json", import.meta.url));

export function loadDemoNetMargins(): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { netMargin?: Record<string, unknown> };
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw.netMargin ?? {})) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1) out[key.trim().toLowerCase()] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export type DemoQuote = {
  purchaseCny: number;
  moldCny: number;
  moq: number;
  freightEur: number;
  fbaEur: number;
};

const costFile = fileURLToPath(new URL("../data/demo-cost.json", import.meta.url));

/** 这一条商品自己的演示报价。没有记录就返回 undefined。 */
export function demoQuote(asin: string): (DemoQuote & { cnyPerEur: number; referralRate: number }) | undefined {
  try {
    const raw = JSON.parse(readFileSync(costFile, "utf8")) as {
      cnyPerEur?: unknown;
      referralRate?: unknown;
      items?: Record<string, Partial<DemoQuote>>;
    };
    const row = raw.items?.[asin.trim().toUpperCase()];
    const cnyPerEur = raw.cnyPerEur;
    const referralRate = raw.referralRate;
    if (!row || typeof cnyPerEur !== "number" || typeof referralRate !== "number") return undefined;
    const { purchaseCny, moldCny, moq, freightEur, fbaEur } = row;
    if (
      typeof purchaseCny !== "number" ||
      typeof moldCny !== "number" ||
      typeof moq !== "number" ||
      typeof freightEur !== "number" ||
      typeof fbaEur !== "number"
    ) {
      return undefined;
    }
    return { purchaseCny, moldCny, moq, freightEur, fbaEur, cnyPerEur, referralRate };
  } catch {
    return undefined;
  }
}

/** 用该商品自己的报价算落地成本。售价、头程、尾程、净利是欧元，字段名仍沿用 Usd。 */
export function demoLandedCost(asin: string, price: number, quote: DemoQuote & { cnyPerEur: number; referralRate: number }): LandedCost {
  const purchaseEur = round2(quote.purchaseCny / quote.cnyPerEur);
  const netProfit = round2(price - purchaseEur - quote.freightEur - quote.fbaEur - price * quote.referralRate);
  return {
    asin,
    purchasePriceUsd: purchaseEur,
    freightPerUnitUsd: quote.freightEur,
    fbaFeeUsd: quote.fbaEur,
    referralRate: quote.referralRate,
    netProfitUsd: netProfit,
    netMargin: round4(netProfit / price),
    moq: quote.moq,
    firstOrderCapitalUsd: Math.round((purchaseEur + quote.freightEur) * quote.moq),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
