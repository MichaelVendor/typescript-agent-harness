# brief-agent P1-A（DE 搜索真抓）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `BRIEF_SOURCE=mock|live`；live 用 DE 搜索 HTML（fixture/curl）填标题与欧元价；mock 回归 5/5 不变。

**Architecture:** `PageSource` 抽象；mock 迁入 `lib/sources/mock.ts`；live 拷贝 selection 的 `parseDeSearchHtml` + curl；`fetch.ts` 走 `activeSource()`；eval 用 fixture 不打外网。

**Tech Stack:** TypeScript、`node:test`、`curl`（仅 live 手工）、既有 brief-agent。

**Spec:** `docs/superpowers/specs/2026-11-20-brief-agent-p1a-live-fetch-design.md`

## Global Constraints

- 不改 `@typescript-agent-harness/*` 核心包
- 不依赖 selection-agent 包；拷贝解析代码并注明来源
- Eval 不访问外网；默认 `BRIEF_SOURCE` 缺省 = mock
- Conventional Commits；不 push；不提交 `out/`、`.superpowers/`、`.env`

## File map

| File | Responsibility |
| --- | --- |
| `lib/sources/types.ts` | `PageSource`, `SourceTarget` |
| `lib/sources/amazon-de-html.ts` | 拷贝 parse + `isBlocked` |
| `lib/sources/mock.ts` | 现 catalog fetch |
| `lib/sources/live-de-search.ts` | match hits + optional `fetchHtml` inject |
| `lib/sources/index.ts` | `activeSource()` |
| `lib/fetch.ts` | 委托 source；支持 targets |
| `lib/compose.ts` | gaps：缺卖点/缺评论摘录 |
| `tools/fetch-product-pages.ts` | 接受 targets 或 ids |
| `data/fixtures/*.html` | eval HTML |
| `eval/cases/live-*.json` + `run-eval.ts` | 新用例 |
| `README.md` | BRIEF_SOURCE |

---

### Task 1: amazon-de-html 拷贝 + 单测

**Files:** Create `lib/sources/amazon-de-html.ts`, `lib/sources/amazon-de-html.test.ts`, fixture snippet in test or `data/fixtures/de-search-ok.html`

- [x] 从 selection 拷贝 `parseDeSearchHtml` / `DeSearchHit`；导出 `isBlocked(html)`（captcha / api-services-support / length < 1000）
- [x] 测试：最小 HTML 含一个 `B0XXXXXXXX` 卡片 → 解析出 title+price；blocked HTML → `isBlocked` true
- [x] Commit: `feat(brief-agent): 接入 DE 搜索 HTML 解析`

### Task 2: PageSource mock + activeSource

**Files:** `types.ts`, `mock.ts`, `index.ts`；改 `fetch.ts` 委托 mock；保持 `fetchProductPages({ ids, failIds })` API

- [x] `activeSource()`：仅 `process.env.BRIEF_SOURCE === "live"` 时 live，否则 mock
- [x] mock 行为与现网一致；`pnpm test` 全绿
- [x] Commit: `refactor(brief-agent): fetch 走 PageSource/mock`

### Task 3: live-de-search + fixture eval

**Files:** `live-de-search.ts`, fixtures, eval cases, extend `run-eval.ts`, compose gaps, tool targets, README

- [x] `liveFetchPages({ targets, fetchHtml?, failIds? })`：按 asin/query/title 匹配；无命中 failure；blocked failure
- [x] eval `live-fixture-asin` / `live-blocked`；mock 原 5 条仍绿（共 ≥7）
- [x] compose：empty bullets → gap `缺卖点`；empty reviews → `缺评论摘录`
- [x] tool：可传 `targets`；仅 `ids` 仍兼容
- [x] Commit: `feat(brief-agent): BRIEF_SOURCE=live 与 fixture eval`

### Task 4: 收尾

- [x] `pnpm test && pnpm smoke && pnpm eval` 全绿
- [x] 更新 p1a design 状态为已实现；P0 design P1-A 勾选
- [x] Commit: `docs(brief-agent): 标记 P1-A 已实现`

---

## Self-review

- Spec §成功标准 / 错误处理 / 评测 / 非目标均有 Task 覆盖
- 无 TBD；不引入浏览器与 `/dp`
