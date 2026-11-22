import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./report.ts";
import type { Marketplace } from "./sources/types.ts";

export type SessionMarketplace = Extract<Marketplace, "DE" | "US">;

export type MarketplaceProfile = {
  marketplace: SessionMarketplace;
  currency: "EUR" | "USD";
  siteLabel: string;
  publishLabel: string;
  shelfUnit: string;
  vatNote: string;
  askLabel: string;
};

const PROFILES: Record<SessionMarketplace, MarketplaceProfile> = {
  DE: {
    marketplace: "DE",
    currency: "EUR",
    siteLabel: "Amazon.de",
    publishLabel: "发布到德国站",
    shelfUnit: "欧元",
    vatNote: "演示店铺，未登记真实德国 VAT",
    askLabel: "德国站",
  },
  US: {
    marketplace: "US",
    currency: "USD",
    siteLabel: "Amazon.com",
    publishLabel: "发布到美国站",
    shelfUnit: "美元",
    vatNote: "演示店铺，未登记真实美国销售税号",
    askLabel: "美国站",
  },
};

/** 本轮选站文件。不用模块内变量：jiti 热加载会丢内存状态。 */
const SESSION_FILE = path.join(PROJECT_ROOT, "data", "session-marketplace.json");

type LiveSlot = { marketplace: SessionMarketplace | null };
const liveSlot =
  (globalThis as { __selectionMarketplace?: LiveSlot }).__selectionMarketplace ??
  ((globalThis as { __selectionMarketplace?: LiveSlot }).__selectionMarketplace = { marketplace: null });

export function parseMarketplace(value: unknown): SessionMarketplace | null {
  if (value === "DE" || value === "US") return value;
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase();
  if (text === "DE" || text.includes("德国")) return "DE";
  if (text === "US" || text.includes("美国")) return "US";
  return null;
}

export function marketplaceProfile(market: SessionMarketplace): MarketplaceProfile {
  return PROFILES[market];
}

function readSessionFile(): SessionMarketplace | null {
  try {
    const raw = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as { marketplace?: unknown };
    return parseMarketplace(raw.marketplace);
  } catch {
    return null;
  }
}

export function activateMarketplace(market: SessionMarketplace): void {
  liveSlot.marketplace = market;
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, `${JSON.stringify({ marketplace: market }, null, 2)}\n`);
}

export function clearLiveMarketplace(): void {
  liveSlot.marketplace = null;
  try {
    unlinkSync(SESSION_FILE);
  } catch {
    // 没有文件就算清过
  }
}

/** 本轮已选站点：内存（globalThis）或 session 文件，不认 case-state 旧值。 */
export function sessionMarketplace(): SessionMarketplace | null {
  return liveSlot.marketplace ?? readSessionFile();
}

export function requireMarketplace(): MarketplaceProfile {
  const market = sessionMarketplace();
  if (!market) {
    throw new Error("还没选站点。先 ask_user「选哪个站点？」选项「德国站」「美国站」，再调用 set_marketplace。");
  }
  return marketplaceProfile(market);
}
