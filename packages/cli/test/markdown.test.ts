import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bold,
  createMarkdownStream,
  dim,
  renderInline,
  renderLine,
  renderMarkdown,
  useColor,
} from "../dist/markdown.js";

const plain = (s: string) => s.replace(/\x1b\[\d+m/g, "");

test("inline: bold, italic, code, link, strike", () => {
  assert.equal(renderInline("a **b** c"), `a ${bold("b")} c`);
  assert.equal(plain(renderInline("*it* and `x*y*z` and ~~old~~")), "it and x*y*z and old");
  assert.match(renderInline("`**raw**`"), /\*\*raw\*\*/);
  assert.equal(plain(renderInline("[docs](https://x.dev)")), "docs (https://x.dev)");
  assert.equal(renderInline("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(renderInline("snake_case_name"), "snake_case_name");
});

test("blocks: heading, list, quote, rule, table", () => {
  const s = { fence: "" };
  assert.equal(renderLine("## Learn C#", s), bold("Learn C#"));
  assert.equal(plain(renderLine("# Title #", s)), "Title");
  assert.equal(renderLine("  - item **x**", s), `  • item ${bold("x")}`);
  assert.equal(plain(renderLine("3. step", s)), "3. step");
  assert.equal(plain(renderLine("> note", s)), "│ note");
  assert.equal(renderLine("---", s), dim("─".repeat(40)));
  assert.equal(renderLine("|---|:-:|", s), dim("|---|:-:|"));
  assert.equal(plain(renderLine("| **a** | b |", s)), "| a | b |");
});

test("fenced code is boxed and left unstyled", () => {
  const out = renderMarkdown("```ts\nconst a = **b**;\n```python\n```\n**after**");
  assert.deepEqual(plain(out).split("\n"), [
    "╭─ ts",
    "│ const a = **b**;",
    "│ ```python",
    "╰─",
    "after",
  ]);
});

test("stream styles whole lines and flush writes the partial line", () => {
  let out = "";
  const md = createMarkdownStream((s) => {
    out += s;
  });
  md.push("# He");
  assert.equal(out, "");
  md.push("llo\n- a");
  assert.equal(plain(out), "Hello\n");
  md.push("\n**tail");
  md.flush();
  assert.equal(plain(out), "Hello\n• a\n**tail");
  md.flush();
  assert.equal(plain(out), "Hello\n• a\n**tail");
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
