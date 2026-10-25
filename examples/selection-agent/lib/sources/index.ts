import { amazonMarketSource } from "./amazon.ts";
import { dossierMarketSource } from "./dossier.ts";
import { mockMarketSource } from "./mock.ts";
import type { MarketSource } from "./types.ts";

/** 默认走选品档案。`SELECTION_SOURCE=mock` 给冒烟和单测，`amazon` 仍是抓搜索页。 */
export function activeMarketSource(): MarketSource {
  const which = process.env.SELECTION_SOURCE ?? "dossier";
  if (which === "mock") return mockMarketSource;
  if (which === "amazon") return amazonMarketSource;
  return dossierMarketSource;
}
