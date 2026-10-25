import assert from "node:assert/strict";
import { test } from "node:test";
import { Transcript } from "../dist/tui/transcript.js";
import { formatToolResult } from "../src/tui/tool-result.ts";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

test("formatToolResult keeps 8 lines when closed and 40 when open", () => {
  const closed = formatToolResult(lines(10), { open: false });
  assert.equal(closed, [...Array.from({ length: 8 }, (_, i) => `line ${i}`), "… 2 more lines"].join("\n"));

  const opened = formatToolResult(lines(45), { open: true });
  assert.equal(opened, [...Array.from({ length: 40 }, (_, i) => `line ${i}`), "… 5 more lines"].join("\n"));

  assert.equal(formatToolResult(lines(8), { open: false }), lines(8));
  assert.equal(formatToolResult(lines(40), { open: true }), lines(40));
});

test("formatToolResult colors diff lines only when color is set", () => {
  const plain = formatToolResult("- old\n+ new\n ctx", { open: false });
  assert.equal(plain, "- old\n+ new\n ctx");

  const colored = formatToolResult("- old\n+ new\n ctx\n-not\n+not", { open: true, color: true });
  assert.deepEqual(colored.split("\n"), [
    "\x1b[2m\x1b[31m- old\x1b[39m\x1b[22m",
    "\x1b[36m+ new\x1b[39m",
    " ctx",
    "-not",
    "+not",
  ]);
});

test("formatToolResult dims the truncation note when color is set", () => {
  const colored = formatToolResult(lines(9), { open: false, color: true });
  assert.equal(colored.split("\n").at(-1), "\x1b[2m… 1 more lines\x1b[22m");
});

test("finalized assistant text records snapshot.model", () => {
  const transcript = new Transcript((s) => s);
  transcript.apply({ type: "user", text: "hi" });
  transcript.apply({ type: "text", delta: "hello" });
  transcript.apply({ type: "turn.end", state: "completed", finishReason: "stop", rounds: 1, model: "alpha" });
  transcript.apply({ type: "user", text: "next" });
  transcript.apply({ type: "text", delta: "world" });
  transcript.apply({ type: "turn.end", state: "completed", finishReason: "stop", rounds: 2, model: "beta" });

  const assistants = transcript.snapshot.items.filter((item) => item.kind === "assistant");
  assert.equal(assistants.length, 2);
  assert.equal(assistants[0]?.kind === "assistant" ? assistants[0].model : undefined, "alpha");
  assert.equal(assistants[1]?.kind === "assistant" ? assistants[1].model : undefined, "beta");
  assert.equal(assistants[0]?.kind === "assistant" ? assistants[0].text : undefined, "hello");
});

test("assistant blocks closed before turn.end still get that turn's model", () => {
  const transcript = new Transcript((s) => s);
  transcript.apply({ type: "user", text: "hi" });
  transcript.apply({ type: "text", delta: "one\n\ntwo" });
  transcript.apply({ type: "turn.end", state: "completed", finishReason: "stop", rounds: 1, model: "alpha" });
  const assistants = transcript.snapshot.items.filter((item) => item.kind === "assistant");
  assert.ok(assistants.length >= 2);
  for (const item of assistants) assert.equal(item.kind === "assistant" ? item.model : undefined, "alpha");
});

test("finalized assistant text omits model when the snapshot has none", () => {
  const transcript = new Transcript((s) => s);
  transcript.apply({ type: "text", delta: "hello" });
  transcript.apply({ type: "turn.end", state: "completed", finishReason: "stop", rounds: 1 });
  const assistant = transcript.snapshot.items.find((item) => item.kind === "assistant");
  assert.ok(assistant && assistant.kind === "assistant");
  assert.equal(assistant.model, undefined);
  assert.equal("model" in assistant, false);
});
