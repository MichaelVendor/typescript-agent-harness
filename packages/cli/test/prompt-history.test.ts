import assert from "node:assert/strict";
import { test } from "node:test";
import { createPromptHistory } from "../src/tui/prompt-history.ts";

test("prompt history searches newest first and caps", () => {
  const h = createPromptHistory(3);
  h.push("alpha");
  h.push("beta one");
  h.push("beta two");
  h.push("gamma");
  assert.deepEqual(h.search("beta"), ["beta two", "beta one"]);
  assert.equal(h.search("").length, 3);
  assert.deepEqual(h.search(""), ["gamma", "beta two", "beta one"]);
});

test("prompt history ignores blank and consecutive duplicates", () => {
  const h = createPromptHistory(10);
  h.push("a");
  h.push("a");
  h.push("  ");
  h.push("b");
  assert.deepEqual(h.search(""), ["b", "a"]);
  h.clear();
  assert.deepEqual(h.search(""), []);
});

test("prompt history search is case-insensitive", () => {
  const h = createPromptHistory(10);
  h.push("Hello World");
  assert.deepEqual(h.search("hello"), ["Hello World"]);
  assert.deepEqual(h.search("WORLD"), ["Hello World"]);
});
