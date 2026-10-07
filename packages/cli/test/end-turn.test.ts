import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStatusLine } from "../dist/runtime.js";

test("formatStatusLine includes finishReason=max_steps hint", () => {
  const line = formatStatusLine("failed", 12, "max_steps");
  assert.match(line, /state=failed/);
  assert.match(line, /steps=12/);
  assert.match(line, /finishReason=max_steps/);
  assert.match(line, /maxSteps|step limit|split/i);
});

test("formatStatusLine omits max_steps hint for completed", () => {
  const line = formatStatusLine("completed", 3, "stop");
  assert.match(line, /state=completed/);
  assert.doesNotMatch(line, /max_steps/);
});
