import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStatusLine, turnRounds } from "../dist/runtime.js";

test("formatStatusLine includes finishReason=max_steps hint", () => {
  const line = formatStatusLine("failed", 12, "max_steps");
  assert.match(line, /state=failed/);
  assert.match(line, /steps=12/);
  assert.match(line, /finishReason=max_steps/);
  assert.match(line, /--max-steps/);
  assert.doesNotMatch(line, /split/);
});

test("formatStatusLine omits max_steps hint for completed", () => {
  const line = formatStatusLine("completed", 3, "stop");
  assert.match(line, /state=completed/);
  assert.doesNotMatch(line, /max_steps/);
});

test("turnRounds counts only LLM steps since the turn started", () => {
  const steps = [{ type: "llm" }, { type: "tool" }, { type: "llm" }, { type: "tool" }, { type: "llm" }];
  const session = { steps } as unknown as Parameters<typeof turnRounds>[0];
  assert.equal(turnRounds(session, 0), 3);
  assert.equal(turnRounds(session, 2), 2);
});
