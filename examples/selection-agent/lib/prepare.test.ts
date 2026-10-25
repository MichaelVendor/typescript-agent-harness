import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { prepareCase, sampleChecks } from "./prepare.ts";

test("试样清单按档案编号切开，结果保持空", () => {
  const checks = sampleChecks("尚未试样：1）买两套对标。2）清洁时间少≥30%。");
  assert.equal(checks.length, 2);
  assert.equal(checks[0]?.gate, "买两套对标");
  assert.equal(checks[0]?.result, null);
});

test("报价三格是空的，链接只复述档案里的结构", () => {
  // Archive only — ignore local data/case-state.json from a prior session.
  const file = fileURLToPath(new URL("../data/DE2610221.json", import.meta.url));
  const prepared = prepareCase(JSON.parse(readFileSync(file, "utf8")));
  assert.equal(prepared.spu, "DE2610221");
  assert.equal(prepared.quote.purchasePrice, null);
  assert.equal(prepared.quote.moldFee, null);
  assert.equal(prepared.quote.moq, null);
  assert.equal(prepared.quote.ask.length, 6);
  assert.ok(prepared.sample.checks.length >= 6);
  assert.ok(prepared.sample.checks.every((item) => item.result === null));
  assert.equal(prepared.listing.title, "便于倒水与拆洗的浴室硅胶托盘三件套");
  assert.ok(prepared.listing.bullets.some((line) => line.includes("不承诺")));
  assert.equal(prepared.listing.priceTarget?.min, 14.99);
  assert.equal(prepared.listing.priceTarget?.max, 16.99);
  assert.equal(prepared.inquiry, null);
});
