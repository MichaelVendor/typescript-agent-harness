import assert from "node:assert/strict";
import { test } from "node:test";
import { createMarkdownStream, renderMarkdown, useColor } from "../dist/markdown.js";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

test("renderMarkdown: inline styles in lists, tables, code blocks", () => {
  const out = plain(
    renderMarkdown(
      "- **补 `slot-id`** 修复\n\n| 命令 | 结果 |\n|---|---|\n| `pnpm test` | ✅ |\n\n```ts\nconst a = 1;\n```",
    ),
  );
  assert.match(out, /补 slot-id 修复/);
  assert.doesNotMatch(out, /\*\*|`/);
  assert.match(out, /┌/);
  assert.match(out, /│ pnpm test/);
  assert.match(out, /const a = 1;/);
  assert.doesNotMatch(out, /^\n|\n$/);
});

function collect() {
  let out = "";
  const md = createMarkdownStream((s) => {
    out += s;
  });
  return { md, out: () => plain(out) };
}

test("stream writes a block once the next block starts, flush writes the rest", () => {
  const { md, out } = collect();
  md.push("# Title\n\npara");
  assert.equal(out(), "");
  md.push("graph one\n\nnext");
  assert.match(out(), /Title\n\n$/);
  md.push("\n");
  assert.match(out(), /paragraph one\n\n$/);
  md.flush();
  assert.match(out(), /next\n$/);
  md.flush();
  assert.match(out(), /next\n$/);
});

test("stream keeps loose lists, indented lines, and fenced blank lines in one block", () => {
  const { md, out } = collect();
  md.push("1. one\n\n2. two\n\n   more of two\n\n");
  assert.equal(out(), "");
  md.push("```\na\n\nb\n```\n");
  assert.match(out(), /1\. one\n\s*2\. two\n\s*more of two\n\n$/);
  md.push("\nafter\n");
  assert.match(out(), /a\n\s*\n\s*b/);
  md.flush();
  assert.match(out(), /after\n$/);
});

test("useColor needs a TTY, no NO_COLOR, and TERM other than dumb", () => {
  const saved = { NO_COLOR: process.env.NO_COLOR, TERM: process.env.TERM };
  delete process.env.NO_COLOR;
  process.env.TERM = "xterm-256color";
  assert.equal(useColor({ isTTY: true }), true);
  assert.equal(useColor({}), false);
  process.env.TERM = "dumb";
  assert.equal(useColor({ isTTY: true }), false);
  process.env.TERM = "xterm-256color";
  process.env.NO_COLOR = "1";
  assert.equal(useColor({ isTTY: true }), false);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
