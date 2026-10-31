# 选品结果看板对比报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `board-page.ts` 生成的选品结果 HTML 改成冷静灰绿、表格式对比报告（设计稿 A），说明/缺口同页统一视觉。

**Architecture:** 只改 `boardPage()` 拼出的 HTML/CSS 与高度估算。`boardCaption`、`BoardRow`、条宽算法、`noteOf`/`linesOf` 语义不变。调用方（`render-board` / `score-and-save` / `board-shot`）零改或仅跟测。

**Tech Stack:** TypeScript（Node 内置 test + `--experimental-strip-types`）、静态 HTML/CSS 字符串模板。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-10-28-board-page-comparison-report-design.md`
- 对照稿：`.superpowers/mockups/board-report-v1.html`（气质对照，不以 mockup 为运行时依赖）
- 只改 `examples/selection-agent/lib/board-page.ts` 与 `lib/board-page.test.ts`（验收截图可本地临时文件，不入库）
- 不改 score / recommend / seller-backend / tah / AGENTS.md
- 保留：`boardPage` 入参形状、`escapeHtml`、DIMS gap 文案、`barWidth` + WEIGHTS/raw 逻辑
- 设计宽约 840px；背景禁止奶油 `#f4f1ea`
- 中文回复；提交用 Conventional Commits；不 push

## File map

| File | Responsibility |
| --- | --- |
| `lib/board-page.ts` | 生成报告 HTML + 估算截图高度 |
| `lib/board-page.test.ts` | 结构/转义/站点/配色断言 |
| `lib/board-shot.ts` | 不改；用 height 截图 |
| `tools/render-board.ts` | 不改调用约定 |

---

### Task 1: 先写失败测试（表结构 + 视觉约束）

**Files:**
- Modify: `examples/selection-agent/lib/board-page.test.ts`
- Test: same

**Interfaces:**
- Consumes: `boardPage`, `boardCaption` from `./board-page.ts`
- Produces: 失败断言，驱动 Task 2 的 HTML 形状

- [ ] **Step 1: 扩展 / 改写 `board-page.test.ts`**

把现有「卡片」假设改成「对比表」断言，并补站点与禁止奶油底：

```ts
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
  assert.match(page.html, />需求</);
  assert.match(page.html, />趋势</);
  assert.match(page.html, />竞争</);
  assert.match(page.html, />利润</);
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
```

说明：`排行对比|…` 与 `shelf` 的断言允许实现时微调 class，但必须以 `<table>` 横比四维；若最终 class 名不同，同步改测试与实现，勿退回 article 卡片榜。

- [ ] **Step 2: 跑测确认失败**

Run:

```bash
cd examples/selection-agent && node --test --experimental-strip-types lib/board-page.test.ts
```

Expected: FAIL（现 HTML 无 `<table>` / `#e8ecf1`，仍有 `#f4f1ea` 或无 meta）

- [ ] **Step 3: Commit 测试**

```bash
git add examples/selection-agent/lib/board-page.test.ts
git commit -m "$(cat <<'EOF'
test(selection-agent): 选品结果页改为对比表断言

为冷静报告风实现先钉结构与配色约束。
EOF
)"
```

---

### Task 2: 重写 `boardPage` HTML/CSS（设计 A）

**Files:**
- Modify: `examples/selection-agent/lib/board-page.ts`
- Test: `examples/selection-agent/lib/board-page.test.ts`

**Interfaces:**
- Consumes: 现有 `BoardRow`、`DIMS`、`barWidth`、`noteOf`、`linesOf`、`escapeHtml`、`WEIGHTS`
- Produces: `boardPage(...): { html: string; height: number }` — 入参不变

- [ ] **Step 1: 替换行渲染为表格行**

在 `boardPage` 内，用下列逻辑替换现有 `cards`（保留 `raw` / `counts` / `stats` 计算）：

```ts
  const actionClass = (action: string) =>
    action === "上架" ? "ok" : action === "观察" ? "warn" : action === "放弃" ? "drop" : "";

  const rowsHtml = input.rows
    .map((row, index) => {
      const image = input.images?.[row.id];
      const photo = image
        ? `<img class="thumb" src="${escapeHtml(image)}" alt="" />`
        : `<span class="thumb photo"></span>`;
      const dims = DIMS.map((dim) => {
        const missing = row.gaps?.includes(dim.gap) ?? false;
        const value = row.breakdown?.[dim.key];
        const shown = !missing && typeof value === "number";
        const width = shown ? barWidth(value, dim.scale, raw) : 0;
        const num = shown ? value.toFixed(3) : "—";
        return `<td class="col-dim"><div class="dim"><span>${dim.label}<em>${num}</em></span><span class="track"><i style="width:${width.toFixed(1)}%"></i></span></div></td>`;
      }).join("");
      const risk = row.riskFlags?.length
        ? `<span class="risk">${escapeHtml(row.riskFlags.join("、"))}</span>`
        : "";
      const shelf = row.action === "上架" ? " shelf" : "";
      return `<tr class="${escapeHtml(actionClass(row.action))}${shelf}">
        <td class="col-rank">${index + 1}</td>
        <td class="col-img">${photo}</td>
        <td class="col-title"><p class="title">${escapeHtml(row.title)}</p><p class="asin">${escapeHtml(row.id)}</p>${risk}</td>
        <td class="col-action"><span class="pill ${actionClass(row.action)}">${escapeHtml(row.action)}</span></td>
        <td class="col-score"><span class="score">${row.total.toFixed(3)}</span></td>
        ${dims}
      </tr>`;
    })
    .join("");
```

- [ ] **Step 2: 组装 meta / hero / 说明 / 缺口 / style**

`site` 改为有 label 才出整条 meta（含右侧「选品结果」）：

```ts
  const meta = input.siteLabel?.trim()
    ? `<div class="meta"><div class="site">${escapeHtml(input.siteLabel.trim())}</div><div class="stamp">选品结果</div></div>`
    : "";
```

结论区：左 lead、右 stats（注意 grid：`1.4fr 1fr`，有 conclusion 时；无 conclusion 则 stats 仍可单独成行——实现选「有 conclusion 用 hero 两列，无则只渲染 stats 一块」）。

排行面板：

```html
<div class="panel">
  <div class="label">排行对比</div>
  <table class="rank">
    <thead>
      <tr>
        <th class="col-rank">#</th>
        <th class="col-img"></th>
        <th class="col-title">商品</th>
        <th class="col-action">动作</th>
        <th class="col-score">总分</th>
        <th class="col-dim">需求</th>
        <th class="col-dim">趋势</th>
        <th class="col-dim">竞争</th>
        <th class="col-dim">利润</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</div>
```

说明 / 缺口：保留 `noteOf` 解析；外层改用 `.panel` + `.notes` / `.gaps`（缺口用 `<span class="gap">` 而非大 pill 圆角 99）。

CSS 关键 token（完整 style 可对照 mockup A，必须包含）：

```css
body { margin: 0; background: #e8ecf1; color: #121820; font: 14px/1.45 "PingFang SC", "Noto Sans SC", "Segoe UI", system-ui, sans-serif; }
main { width: 840px; margin: 0 auto; padding: 22px 20px 28px; }
/* paper #f7f9fb, line #d5dde6, accent #0c5c6b, bar #1a6f7c */
/* .pill.ok / .warn / .drop；tr.shelf 淡绿底；.thumb 44x44 radius 6；.track height 6px */
```

禁止再出现 `#f4f1ea`、`#c96442` 陶土条（条改为墨绿蓝）。

- [ ] **Step 3: 调整 height 估算**

表行更扁，例如：

```ts
  const rowsHeight = input.rows.reduce(
    (sum, row) => sum + 72 + Math.ceil(row.title.length / 48) * 16,
    0,
  );
  const height =
    180 +
    (input.siteLabel?.trim() ? 28 : 0) +
    (input.conclusion?.trim() ? 72 : 48) +
    rowsHeight +
    (notes.length ? 48 + Math.ceil(notes.length / 2) * 72 : 0) +
    (gaps.length ? 64 : 0);
  return { html, height: Math.max(720, Math.min(height, 12000)) };
```

（数值可微调，但单测仍要求 `height >= 480`。）

- [ ] **Step 4: 跑测至通过**

```bash
cd examples/selection-agent && node --test --experimental-strip-types lib/board-page.test.ts
```

Expected: 全部 PASS。若 Step 1 正则过严，只放宽到仍强制 `<table>` + `#e8ecf1` + 无 `#f4f1ea`。

- [ ] **Step 5: Commit**

```bash
git add examples/selection-agent/lib/board-page.ts examples/selection-agent/lib/board-page.test.ts
git commit -m "$(cat <<'EOF'
feat(selection-agent): 选品结果页改为表格式对比报告

冷静灰绿配色，四维横比，说明与缺口同页统一。
EOF
)"
```

---

### Task 3: 本地截图冒烟（不入库）

**Files:** 无仓库改动（或仅临时 `out/`）

**Interfaces:**
- Consumes: `boardPage` / 现有 `board-shot` 或手写 HTML 落盘
- Produces: 人工确认的 PNG/HTML 预览

- [ ] **Step 1: 落盘一页 HTML**

```bash
cd examples/selection-agent && node --experimental-strip-types -e '
import { writeFileSync, mkdirSync } from "node:fs";
import { boardPage } from "./lib/board-page.ts";
const page = boardPage({
  siteLabel: "Amazon.de",
  conclusion: "15 条里 2 条建议上架，4 条观察，9 条放弃。",
  notes: "Deko Tablett：需求高；要验证的是头程。\n套装托盘：客单更高；要验证的是体积。",
  gaps: "- 利润（无采购成本）· 部分候选\n- 趋势序列仅快照",
  images: {},
  rows: [
    { id: "B0DEKO0001", title: "Deko Tablett Rund Ø 28", total: 0.742, action: "上架", breakdown: { demand: 0.82, trend: 0.71, competition: 0.68, margin: 0.76 } },
    { id: "B0DEKO0003", title: "2 STK Deko Tablett Rund", total: 0.701, action: "上架", breakdown: { demand: 0.78, trend: 0.66, competition: 0.72, margin: 0.64 } },
    { id: "B0DEKO0002", title: "Dekoratives Tablett 23 cm", total: 0.612, action: "观察", breakdown: { demand: 0.61, trend: 0.55, competition: 0.7, margin: 0.48 } },
    { id: "B0BATH0001", title: "Badezimmer Tablett", total: 0.381, action: "放弃", breakdown: { demand: 0.42, trend: 0.33, competition: 0.4 }, gaps: ["利润（无采购成本）"] },
  ],
});
mkdirSync("out", { recursive: true });
writeFileSync("out/board-preview.html", page.html);
console.log("height", page.height, "→ out/board-preview.html");
'
```

- [ ] **Step 2: 浏览器打开核对**

打开 `examples/selection-agent/out/board-preview.html`（或 `python3 -m http.server` 该目录）。对照 spec 验收：灰底、表横比、说明/缺口、无奶油底。

若项目已有 `board-shot`，可再截一张 PNG 人工看；PNG 与 preview HTML **不要 commit**。

- [ ] **Step 3: 确认无意外改动**

```bash
git status
```

Expected: 工作区干净（或仅有故意忽略的 `out/`）。

---

## Self-review

1. **Spec coverage:** 顶栏 meta、hero 结论+计数、对比表四维、说明两列、缺口标签、token 配色、840 宽、不改调用约定 → Task 1–2；人工验收 → Task 3。
2. **Placeholders:** 无 TBD；测试与实现片段已写出。
3. **Types:** `boardPage` 签名未改；`actionClass` 仅内部。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-28-board-page-comparison-report.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 开新子代理，Task 间你审查  

**2. Inline Execution** — 本会话按 executing-plans 连续做，设检查点  

Which approach?
