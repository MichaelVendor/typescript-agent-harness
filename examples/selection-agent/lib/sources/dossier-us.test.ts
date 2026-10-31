import assert from "node:assert/strict";
import { test } from "node:test";
import { dossierUsMarketSource } from "./dossier-us.ts";

test("美国站档案能搜到 bathroom tray 且货币是 USD", async () => {
  assert.equal(dossierUsMarketSource.name, "dossier:US");
  const hits = await dossierUsMarketSource.searchProducts({ query: "bathroom tray", limit: 8 });
  assert.ok(hits.length >= 4);
  assert.ok(hits.every((item) => item.marketplace === "US" && item.currency === "USD"));
  const first = hits[0]!;
  const demand = await dossierUsMarketSource.keywordMetrics(first.asin);
  assert.ok(demand);
  assert.equal(demand!.keyword, "bathroom tray");
  assert.ok((demand!.monthlySearchVolume ?? 0) > 10000);
  const cost = await dossierUsMarketSource.landedCost(first.asin, { priceUsd: first.priceUsd });
  assert.ok(cost);
  assert.ok(cost!.netMargin > 0.2);
});

test("under sink organizer 没有演示报价", async () => {
  const hits = await dossierUsMarketSource.searchProducts({ query: "under sink organizer", limit: 4 });
  assert.ok(hits.length >= 1);
  const cost = await dossierUsMarketSource.landedCost(hits[0]!.asin, { priceUsd: hits[0]!.priceUsd });
  assert.equal(cost, undefined);
});
