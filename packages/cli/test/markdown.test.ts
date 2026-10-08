import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bold,
  createMarkdownStream,
  dim,
  displayWidth,
  renderInline,
  renderLine,
  renderMarkdown,
  renderTable,
  wrapStyled,
} from "../dist/markdown.js";
import { useColor } from "../dist/markdown.js";

const plain = (s: string) => s.replace(/\x1b\[\d+m/g, "");

test("inline: bold, italic, code, link, strike", () => {
  assert.equal(renderInline("a **b** c"), `a ${bold("b")} c`);
  assert.equal(plain(renderInline("*it* and `x*y*z` and ~~old~~")), "it and x*y*z and old");
  assert.match(renderInline("`**raw**`"), /\*\*raw\*\*/);
  assert.equal(plain(renderInline("[docs](https://x.dev)")), "docs (https://x.dev)");
  assert.equal(renderInline("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(renderInline("snake_case_name"), "snake_case_name");
});

test("inline: emphasis wraps around inline code", () => {
  const out = renderInline("**补 `slot-id` 不自动挂载** 然后");
  assert.equal(plain(out), "补 slot-id 不自动挂载 然后");
  assert.ok(out.startsWith("\x1b[1m"));
  assert.match(out, /\x1b\[36mslot-id\x1b\[39m/);
});

test("blocks: heading, list, quote, rule", () => {
  const s = { fence: "" };
  assert.equal(renderLine("## Learn C#", s), bold("Learn C#"));
  assert.equal(plain(renderLine("# Title #", s)), "Title");
  assert.equal(renderLine("  - item **x**", s), `  • item ${bold("x")}`);
  assert.equal(plain(renderLine("3. step", s)), "3. step");
  assert.equal(plain(renderLine("> note", s)), "│ note");
  assert.equal(renderLine("---", s), dim("─".repeat(40)));
});

test("displayWidth counts CJK and emoji as two cells", () => {
  assert.equal(displayWidth("ab"), 2);
  assert.equal(displayWidth("命令"), 4);
  assert.equal(displayWidth("✅ ok"), 5);
  assert.equal(displayWidth(bold("x")), 1);
  assert.equal(displayWidth("⚠️"), 2);
  assert.equal(displayWidth("1️⃣"), 2);
  assert.equal(displayWidth("🗑️"), 2);
  assert.equal(displayWidth("⚠"), 1);
});

test("wrapStyled keeps emoji variation selectors with their base character", () => {
  const lines = wrapStyled("ab⚠️cd", 3);
  assert.deepEqual(lines, ["ab", "⚠️c", "d"]);
});

test("table: box borders, CJK-aligned columns, bold header", () => {
  const out = renderTable(["| 命令 | 结果 |", "|---|---:|", "| `pnpm test` | ✅ 28/28 |"], 80).map(plain);
  assert.deepEqual(out, [
    "┌───────────┬──────────┐",
    "│ 命令      │     结果 │",
    "├───────────┼──────────┤",
    "│ pnpm test │ ✅ 28/28 │",
    "└───────────┴──────────┘",
  ]);
  for (const line of out) assert.equal(displayWidth(line), displayWidth(out[0]!));
});

test("table: wide cells wrap inside the column to fit the terminal", () => {
  const long = "产出 dist/ (ssp-wc-v0.0.1.js 0.79kB + define.js 12.77kB + .d.ts)";
  const out = renderTable(["| 命令 | 结果 |", "|---|---|", `| build | ${long} |`], 40).map(plain);
  for (const line of out) assert.equal(displayWidth(line), 40);
  const body = out.slice(3, -1);
  assert.ok(body.length > 1);
  const column2 = body.map((l) => l.split("│")[2]!.trim()).join(" ");
  assert.equal(column2, long);
});

test("table without a separator row stays as text", () => {
  assert.equal(plain(renderTable(["| a | b |"], 80)[0]!), "| a | b |");
});

test("wrapStyled re-opens styles on the next line", () => {
  const lines = wrapStyled(bold("aaa bbb"), 4);
  assert.deepEqual(lines.map(plain), ["aaa", "bbb"]);
  assert.ok(lines[1]!.startsWith("\x1b[1m"));
  assert.ok(lines[0]!.endsWith("\x1b[22m"));
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

test("stream holds table rows until the table ends", () => {
  let out = "";
  const md = createMarkdownStream(
    (s) => {
      out += s;
    },
    () => 80,
  );
  md.push("| a | b |\n|---|---|\n| 1 | 2 |\n");
  assert.equal(out, "");
  md.push("after\n");
  assert.equal(plain(out).split("\n")[0], "┌───┬───┐");
  assert.match(plain(out), /└───┴───┘\nafter\n$/);

  out = "";
  md.push("| x |\n|---|\n| y |\n");
  md.flush();
  assert.match(plain(out), /└───┘\n$/);
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
