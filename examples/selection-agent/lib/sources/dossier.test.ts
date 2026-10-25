import assert from "node:assert/strict";
import { test } from "node:test";
import { dossierMarketSource, monthlySearchEstimate, monthsOnSale } from "./dossier.ts";

test("月搜索量只从备注句子里取估算值", () => {
  assert.equal(monthlySearchEstimate("月搜索量估算2826；卖家精灵商品数1912"), 2826);
  assert.equal(monthlySearchEstimate("没有估算"), null);
});

test("上架月龄按导出日和上架日的月份差", () => {
  assert.equal(monthsOnSale("2026-09-12", "2026-10-23T00:57:42.213Z"), 1);
  assert.equal(monthsOnSale("2025-10-13", "2026-10-23T00:57:42.213Z"), 12);
  assert.equal(monthsOnSale("not-a-date", "2026-10-23"), null);
});

test("档案搜索返回德国站欧元价，不抓亚马逊页面", async () => {
  const all = await dossierMarketSource.searchProducts({ limit: 8 });
  assert.equal(dossierMarketSource.name, "dossier:DE2610221");
  assert.equal(dossierMarketSource.isMock, false);
  assert.equal(all.length, 8);
  assert.deepEqual(
    all.slice(0, 3).map((item) => [item.asin, item.priceUsd, item.currency, item.marketplace]),
    [
      ["B0HCZ3P6B9", 11.59, "EUR", "DE"],
      ["B0GST7MBPT", 19.59, "EUR", "DE"],
      ["B0FLW7VPTN", 7.99, "EUR", "DE"],
    ],
  );
  const band = await dossierMarketSource.searchProducts({ minPriceUsd: 10, maxPriceUsd: 15, limit: 20 });
  assert.ok(band.some((item) => item.asin === "B0HCZ3P6B9"));
  assert.ok(band.every((item) => item.priceUsd >= 10 && item.priceUsd <= 15));
  const chinese = await dossierMarketSource.searchProducts({ query: "浴室硅胶", limit: 8 });
  assert.equal(chinese.length, 3);
  const miss = await dossierMarketSource.searchProducts({ query: "pet fountain", limit: 8 });
  assert.equal(miss.length, 0);
  const extra = await dossierMarketSource.searchProducts({ query: "dekotablett", limit: 8 });
  assert.ok(extra.length > 0);
  assert.ok(extra.every((item) => item.currency === "EUR"));
});

test("竞品用档案里的 3 条，成本仍空；需求从 keyword-metrics 快照取", async () => {
  const snap = await dossierMarketSource.competitorSnapshot("B0GST7MBPT");
  assert.deepEqual(snap?.topSellerReviews, [329, 51, 1]);
  assert.equal(snap?.lowReviewShare, 0.667);
  assert.equal(snap?.closedSet, true);
  assert.equal(snap?.brandConcentration, null);
  assert.equal(snap?.medianListingAgeMonths, 7);
  const demand = await dossierMarketSource.keywordMetrics("B0GST7MBPT");
  assert.equal(demand?.keyword, "badezimmer tablett");
  assert.equal(demand?.monthlySearchVolume, 2826);
  assert.equal(demand?.trend3m, 0.0733);
  assert.equal(demand?.monthlySeries, undefined);
  assert.equal(await dossierMarketSource.landedCost("B0GST7MBPT", { priceUsd: 19.59 }), undefined);
  const words = await dossierMarketSource.keywordObservations?.("B0HCZ3P6B9");
  assert.equal(words?.[0]?.keyword, "badezimmer tablett");
  assert.equal(words?.[0]?.monthlySearchEstimate, 2826);
  assert.equal(await dossierMarketSource.competitorSnapshot("B0NOPE"), undefined);
  const extra = await dossierMarketSource.searchProducts({ query: "dekotablett", limit: 8 });
  const catalogHit = extra.find((item) => item.category === "dekotablett");
  assert.ok(catalogHit);
  const catalogSnap = await dossierMarketSource.competitorSnapshot(catalogHit.asin);
  assert.equal(catalogSnap?.closedSet, undefined);
  assert.ok((catalogSnap?.topSellerReviews.length ?? 0) > 0);
  assert.equal(catalogSnap?.brandConcentration, null);
  assert.equal(await dossierMarketSource.keywordObservations?.(catalogHit.asin), undefined);
  const catalogDemand = await dossierMarketSource.keywordMetrics(catalogHit.asin);
  assert.equal(catalogDemand?.keyword, "dekotablett");
  assert.equal(catalogDemand?.monthlySearchVolume, 9778);
  assert.equal(catalogDemand?.trend3m, 0.4087);
});
