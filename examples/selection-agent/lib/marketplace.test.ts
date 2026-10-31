import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activateMarketplace,
  clearLiveMarketplace,
  marketplaceProfile,
  parseMarketplace,
  requireMarketplace,
  sessionMarketplace,
} from "./marketplace.ts";

test("parseMarketplace 认 DE / US 和中文", () => {
  assert.equal(parseMarketplace("DE"), "DE");
  assert.equal(parseMarketplace("美国站"), "US");
  assert.equal(parseMarketplace("德国站"), "DE");
  assert.equal(parseMarketplace("nope"), null);
});

test("marketplaceProfile 给出站点和发布文案", () => {
  assert.equal(marketplaceProfile("DE").publishLabel, "发布到德国站");
  assert.equal(marketplaceProfile("US").publishLabel, "发布到美国站");
  assert.equal(marketplaceProfile("US").currency, "USD");
  assert.equal(marketplaceProfile("DE").siteLabel, "Amazon.de");
});

test("未 activate 时不算已选站", () => {
  clearLiveMarketplace();
  assert.equal(sessionMarketplace(), null);
  assert.throws(() => requireMarketplace(), /还没选站点/);
  activateMarketplace("US");
  assert.equal(requireMarketplace().marketplace, "US");
  clearLiveMarketplace();
});
