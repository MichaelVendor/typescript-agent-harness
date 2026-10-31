import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHits, isBlocked, pullIntervalMs } from "../plugins/pull-de-search.ts";

test("只更新已有 asin 的价和评论数，不改标题", () => {
  const products = [
    { asin: "B0AAAAAAA1", title: "旧标题", price: 10, reviewCount: 3 },
    { asin: "B0BBBBBBB2", title: "另一条", price: 5 },
  ];
  const { updated } = applyHits(products, [
    { asin: "B0AAAAAAA1", title: "新标题", price: 12.5, reviewCount: 9 },
    { asin: "B0CCCCCCCC", title: "新商品", price: 1 },
  ]);
  assert.equal(updated, 1);
  assert.equal(products[0]?.title, "旧标题");
  assert.equal(products[0]?.price, 12.5);
  assert.equal(products[0]?.reviewCount, 9);
  assert.equal(products.length, 2);
});

test("拒绝页和过短页面算被拦", () => {
  assert.equal(isBlocked("please contact api-services-support@amazon.com"), true);
  assert.equal(isBlocked("short"), true);
  assert.equal(isBlocked(`${"x".repeat(1000)}data-asin`), false);
});

test("间隔夹在 3 到 15 分钟", () => {
  const previous = process.env.SELECTION_PULL_MINUTES;
  process.env.SELECTION_PULL_MINUTES = "1";
  assert.equal(pullIntervalMs(), 3 * 60 * 1000);
  process.env.SELECTION_PULL_MINUTES = "40";
  assert.equal(pullIntervalMs(), 15 * 60 * 1000);
  delete process.env.SELECTION_PULL_MINUTES;
  assert.equal(pullIntervalMs(), 4 * 60 * 1000);
  if (previous !== undefined) process.env.SELECTION_PULL_MINUTES = previous;
});
