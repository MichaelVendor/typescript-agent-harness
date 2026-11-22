import assert from "node:assert/strict";
import { test } from "node:test";
import { appearsBefore, assertToolOrder, matchesExpectedOrder, toolsFromJsonl } from "./assert-trace.ts";

test("期望工具序是实际调用的子序列", () => {
  assert.equal(
    matchesExpectedOrder(
      ["set_marketplace", "search_products", "keyword_metrics", "score_and_save"],
      ["set_marketplace", "search_products", "score_and_save"],
    ),
    true,
  );
  assert.equal(matchesExpectedOrder(["search_products", "set_marketplace"], ["set_marketplace", "search_products"]), false);
});

test("search 出现在 set_marketplace 之前能被检出", () => {
  assert.equal(appearsBefore(["search_products", "set_marketplace"], "search_products", "set_marketplace"), true);
  assert.equal(appearsBefore(["set_marketplace", "search_products"], "search_products", "set_marketplace"), false);
});

test("assertToolOrder 带回可读原因", () => {
  const bad = assertToolOrder(["search_products"], ["set_marketplace", "search_products"]);
  assert.equal(bad.ok, false);
  assert.match(bad.reason ?? "", /期望顺序/);
});

test("jsonl 抽工具名", () => {
  const text = [
    JSON.stringify({ at: "t", tool: "set_marketplace", ok: true }),
    JSON.stringify({ at: "t", tool: "search_products", ok: true }),
    "not-json",
  ].join("\n");
  assert.deepEqual(toolsFromJsonl(text), ["set_marketplace", "search_products"]);
});
