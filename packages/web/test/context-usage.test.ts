import assert from "node:assert/strict";
import { test } from "node:test";
import { contextPercent, contextWindow } from "../src/context-usage.ts";

test("contextWindow picks a size from the model name", () => {
  assert.equal(contextWindow("deepseek-chat"), 128_000);
  assert.equal(contextWindow("claude-sonnet-4"), 200_000);
  assert.equal(contextWindow(undefined), 128_000);
});

test("contextPercent is undefined until there is usage", () => {
  assert.equal(contextPercent(undefined, "deepseek-chat"), undefined);
  assert.equal(contextPercent({ promptTokens: 0, completionTokens: 0 }, "deepseek-chat"), undefined);
  assert.equal(contextPercent({ promptTokens: 64_000, completionTokens: 0 }, "deepseek-chat"), 50);
  assert.equal(contextPercent({ promptTokens: 200_000, completionTokens: 0 }, "deepseek-chat"), 100);
});
