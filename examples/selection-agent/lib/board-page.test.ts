import assert from "node:assert/strict";
import { test } from "node:test";
import { boardCaption, boardPage } from "./board-page.ts";

test("选品页是对比表：结论、站点、四维列、转义标题", () => {
  const page = boardPage({
    conclusion: "这批可以往下走。",
    notes: "米色托盘：利润尚可；要验证的是头程。",
    gaps: "- 没有 12 个月搜索序列",
    siteLabel: "Amazon.de",
    images: { B0TEST: "https://m.media-amazon.com/images/I/abc.jpg" },
    rows: [
      {
        id: "B0TEST",
        title: "托盘 <新品>",
        total: 0.912,
        action: "上架",
        breakdown: { demand: 0.274, trend: 0.14, competition: 0.2, margin: 0.298 },
        gaps: ["趋势（无近 3 个月搜索序列）"],
      },
      {
        id: "B0SKIP",
        title: "观察款",
        total: 0.5,
        action: "观察",
        breakdown: { demand: 0.1, trend: 0.1, competition: 0.1, margin: 0.1 },
      },
    ],
  });
  assert.match(page.html, /这批可以往下走/);
  assert.match(page.html, /Amazon\.de/);
  assert.match(page.html, /选品结果/);
  assert.match(page.html, /<table[\s\S]*排行对比|排行对比[\s\S]*<table/);
  assert.match(page.html, /托盘 &lt;新品&gt;/);
  assert.match(page.html, /B0TEST/);
  assert.match(page.html, /0\.912/);
  assert.match(page.html, /<th[^>]*>需求</);
  assert.match(page.html, /<th[^>]*>趋势</);
  assert.match(page.html, /<th[^>]*>竞争</);
  assert.match(page.html, /<th[^>]*>利润</);
  assert.match(page.html, /class="[^"]*shelf[^"]*"|tr class="shelf"/);
  assert.match(page.html, /src="https:\/\/m\.media-amazon\.com\/images\/I\/abc\.jpg"/);
  assert.match(page.html, /没有 12 个月搜索序列/);
  assert.match(page.html, /#e8ecf1/);
  assert.doesNotMatch(page.html, /#f4f1ea/);
  assert.ok(page.height >= 480);
});

test("看板结论只数建议动作", () => {
  assert.equal(
    boardCaption([{ action: "上架" }, { action: "上架" }, { action: "观察" }, { action: "放弃" }]),
    "4 条里 2 条建议上架，1 条观察，1 条放弃。",
  );
});

test("无 siteLabel 时不渲染站点顶栏", () => {
  const page = boardPage({
    rows: [{ id: "B0X", title: "x", total: 0.1, action: "放弃" }],
  });
  assert.doesNotMatch(page.html, /class="meta"/);
});

test("长标题多行时高度估算不低于实际渲染需求", () => {
  const longTitle = "A".repeat(180);
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: `B0LONG${i}`,
    title: longTitle,
    total: 0.5,
    action: "观察" as const,
    breakdown: { demand: 0.1, trend: 0.1, competition: 0.1, margin: 0.1 },
  }));
  const page = boardPage({
    conclusion: "长标题回归。",
    notes: "说明一：要验证的是 A。\n说明二：要验证的是 B。",
    gaps: "- 缺口项一\n- 缺口项二",
    siteLabel: "Amazon.de",
    rows,
  });
  assert.ok(page.height > 2504);
  assert.ok(page.height >= 2800);
});

test("未知动作渲染 neutral pill", () => {
  const page = boardPage({
    rows: [{ id: "B0PEND", title: "待定款", total: 0.4, action: "待定" }],
  });
  assert.match(page.html, /pill neutral/);
});
