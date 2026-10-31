import { sessionMarketplace } from "../marketplace.ts";
import { amazonMarketSource } from "./amazon.ts";
import { dossierMarketSource } from "./dossier.ts";
import { dossierUsMarketSource } from "./dossier-us.ts";
import { mockMarketSource } from "./mock.ts";
import type { MarketSource } from "./types.ts";

/**
 * 当前数据源。
 * `SELECTION_SOURCE=mock|amazon` 仍优先（冒烟/真搜）。
 * 否则按会话站点：US → 美国档案，默认/DE → 德国档案。
 */
export function activeMarketSource(): MarketSource {
  const which = process.env.SELECTION_SOURCE ?? "dossier";
  if (which === "mock") return mockMarketSource;
  if (which === "amazon") return amazonMarketSource;
  const market = sessionMarketplace();
  if (market === "US") return dossierUsMarketSource;
  return dossierMarketSource;
}
