# 选品台模拟后台视觉升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `seller-backend/index.html` 做成正式的中文跨境运营台「选品台」，流程与 agent 点击路径不变。

**Architecture:** 单文件重做 CSS + 少量 DOM（顶栏、进度条、卡片分组）。JS 行为、表单 id、侧栏文案、`publish` API 不动。

**Tech Stack:** 静态 HTML/CSS/JS，本地 `serve.py` 已有。

## Global Constraints

- 只改 `examples/selection-agent/seller-backend/index.html`
- 不改 `serve.py`、skill、AGENTS.md、tah
- 保留：`seller`/`demo`；侧栏字「商品/准备/编辑链接/入库/广告/买家页面」；按钮「发布到德国站」；所有现有 `id` / `data-tab`
- 品牌名：选品台；方向：国内跨境运营台（蓝绿主色，非亚马逊橙）

---

### Task 1: 登录 + 壳子 + 全局样式

**Files:** `examples/selection-agent/seller-backend/index.html`

- [x] 重写 `:root` 与全局样式（字体、顶栏、侧栏、卡片、标签、主按钮）；删掉 `.shot` 后残留无选择器规则
- [x] 登录标题改为「选品台」；副文案保留本地模拟语义
- [x] 侧栏品牌改为选品台 · 德国站；主区加顶栏信息（Amazon.de · SKU · 状态）与进度条 DOM
- [x] `show()` / `enter()` / `render()` 里同步进度条当前步与状态标签，不改 tab 切换逻辑

### Task 2: 各面板信息结构

**Files:** 同上

- [x] `renderPrep`：报价/试样/链接卡片加状态标签；金额用小网格
- [x] 编辑页左右分区样式；`#pack` / 入库 / 广告加醒目状态标签
- [x] `buyerHtml` / `#shop`：主图与价格层级加强，演示说明降为次要区

### Task 3: 回归

- [x] 确认 7455 在跑；浏览器打开登录、切六个入口、看准备数据、发布与 `#shop`
- [x] grep 确认按钮文案与关键 id 仍在

---

## Self-review

- Spec 每条目标都落在 Task 1–2
- 不变清单在 Task 3
- 无额外文件拆分（符合做法 A）
