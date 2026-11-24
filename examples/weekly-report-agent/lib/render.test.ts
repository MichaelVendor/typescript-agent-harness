import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./render.ts";
import type { ExtractResult } from "./schema.ts";

const sample: ExtractResult = {
  periodHint: "W47",
  items: [
    { id: "i1", section: "done", text: "灰度上线", evidence: "e1" },
    { id: "i2", section: "wip", text: "登录重构", evidence: "e2" },
    { id: "i3", section: "risk", text: "文档无人更新", evidence: "e3" },
    { id: "i4", section: "next", text: "监控看板", evidence: "e4" },
    { id: "i5", section: "unclassified", text: "拉面", evidence: "e5" },
  ],
  gaps: ["i5 无法归类"],
};

test("ops has four sections and excludes unclassified from main", () => {
  const { markdown } = renderReport(sample, "ops");
  assert.match(markdown, /## 完成/);
  assert.match(markdown, /## 进行中/);
  assert.match(markdown, /## 风险/);
  assert.match(markdown, /## 下周/);
  assert.match(markdown, /灰度上线/);
  assert.match(markdown, /## 缺口/);
  // unclassified 可出现在缺口，但不应作为主表 bullet 冒充完成项
  const main = markdown.split("## 缺口")[0]!;
  assert.doesNotMatch(main, /拉面/);
});

test("exec is one-pager without inventing items", () => {
  const { markdown } = renderReport(sample, "exec");
  assert.match(markdown, /## 摘要/);
  assert.match(markdown, /## 下周/);
  assert.match(markdown, /监控看板/);
  assert.doesNotMatch(markdown, /日历|Jira/);
});

test("exec summary caps at 5 bullets from done/wip/risk only", () => {
  const many: ExtractResult = {
    items: [
      ...["a", "b", "c"].map((t, n) => ({ id: `d${n}`, section: "done" as const, text: `done-${t}`, evidence: "e" })),
      ...["a", "b", "c"].map((t, n) => ({ id: `w${n}`, section: "wip" as const, text: `wip-${t}`, evidence: "e" })),
      ...["a", "b", "c"].map((t, n) => ({ id: `r${n}`, section: "risk" as const, text: `risk-${t}`, evidence: "e" })),
      { id: "n0", section: "next", text: "next-a", evidence: "e" },
    ],
    gaps: [],
  };
  const { markdown } = renderReport(many, "exec");
  const summary = markdown.split("## 摘要")[1]!.split("## 下周")[0]!;
  const bullets = summary.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, 5);
  assert.doesNotMatch(summary, /next-a/);
  assert.doesNotMatch(summary, /done-c|wip-c|risk-c/);
  // round-robin: each section gets a first slot before any second slot
  assert.match(summary, /done-a/);
  assert.match(summary, /wip-a/);
  assert.match(summary, /risk-a/);
  assert.match(summary, /done-b/);
  assert.match(summary, /wip-b/);
  const idx = (text: string) => summary.indexOf(text);
  assert.ok(idx("risk-a") < idx("done-b"), "risk first slot before done second");
  assert.ok(idx("risk-a") < idx("wip-b"), "risk first slot before wip second");
});

test("exec summary lists only what exists", () => {
  const few: ExtractResult = {
    items: [{ id: "i1", section: "done", text: "仅一项", evidence: "e" }],
    gaps: [],
  };
  const { markdown } = renderReport(few, "exec");
  const summary = markdown.split("## 摘要")[1]!.split("## 下周")[0]!;
  assert.equal(summary.split("\n").filter((l) => l.startsWith("- ")).length, 1);
});

test("renderReport rejects invalid template", () => {
  assert.throws(() => renderReport(sample, "bogus" as unknown as "ops"), /template/i);
});
