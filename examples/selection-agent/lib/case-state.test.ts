import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCaseState } from "./case-state.ts";
import { loadPreparedCase } from "./prepare.ts";

const blank = loadPreparedCase();

test("三项都记下才算已报价，文案不动", () => {
  const partial = applyCaseState(blank, { quote: { purchasePrice: 28 } });
  assert.equal(partial.quote.status, "待报价");
  assert.equal(partial.quote.purchasePrice, 28);
  assert.equal(partial.quote.moldFee, null);
  const quoted = applyCaseState(blank, { quote: { purchasePrice: 28, moldFee: 12000, moq: 500 } });
  assert.equal(quoted.quote.status, "已报价");
  assert.equal(quoted.quote.currency, "CNY");
  assert.equal(quoted.listing.title, blank.listing.title);
});

test("缺汇率不算利润，五项给齐才按目标价出区间", () => {
  const missing = applyCaseState(blank, { quote: { purchasePrice: 28, cnyPerEur: 8, freightEur: 2, fbaFeeEur: 3 } });
  assert.equal(missing.margin, null);
  const ready = applyCaseState(blank, {
    quote: { purchasePrice: 28, cnyPerEur: 8, freightEur: 2, fbaFeeEur: 3, referralRate: 0.15 },
  });
  assert.equal(ready.margin?.purchaseEur, 3.5);
  const low = Math.round((14.99 - 3.5 - 2 - 3 - 14.99 * 0.15) * 10000) / 10000;
  assert.equal(ready.margin?.netProfitEur.low, low);
  assert.ok((ready.margin?.netMargin.low ?? 0) > 0);
});

test("试样按编号记录，链接确认不改标题", () => {
  const id = blank.sample.checks[0]?.id ?? "1";
  const partial = applyCaseState(blank, { sample: { [id]: "清洁时间少了 30%" } });
  assert.equal(partial.sample.status, "部分记录");
  assert.equal(partial.sample.checks[0]?.result, "清洁时间少了 30%");
  const results = Object.fromEntries(blank.sample.checks.map((item) => [item.id, "已测"]));
  const done = applyCaseState(blank, { sample: results, listingConfirmed: true });
  assert.equal(done.sample.status, "已记录");
  assert.equal(done.listing.status, "已确认");
  assert.equal(done.listing.title, blank.listing.title);
  const picked = applyCaseState(blank, {
    shelf: { sku: "B0TEST", title: "Deko Tablett", priceEur: 12.5, category: "dekotablett" },
  });
  assert.equal(picked.shelf?.sku, "B0TEST");
  assert.equal(picked.shelf?.priceEur, 12.5);
  assert.equal(picked.store?.germanTitle, "Deko Tablett");
  assert.equal(picked.store?.gtin, "DEMO-B0TEST");
  assert.match(picked.store?.vatNote ?? "", /未登记真实德国 VAT/);
  assert.match(picked.store?.adsNote ?? "", /没有预算/);
  assert.equal(applyCaseState(blank, { shelf: { sku: "B0TEST", title: "x", priceEur: 0, category: "dekotablett" } }).shelf, null);
});

test("询盘记下 asin 和清单，不写成已报价", () => {
  assert.equal(applyCaseState(blank, {}).inquiry, null);
  const ready = applyCaseState(blank, {
    inquiry: { asin: "B0TEST", title: "Deko Tablett", items: ["硅胶净重", "包材"] },
  });
  assert.equal(ready.inquiry?.status, "已发起");
  assert.equal(ready.inquiry?.asin, "B0TEST");
  assert.deepEqual(ready.inquiry?.items, ["硅胶净重", "包材"]);
  assert.equal(ready.quote.status, "待报价");
});
