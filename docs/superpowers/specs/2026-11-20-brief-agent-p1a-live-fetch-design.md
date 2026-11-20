# brief-agent P1-A：DE 搜索真抓（live fetch）设计

状态：P1-A 已实现（`examples/brief-agent`；计划 `docs/superpowers/plans/2026-11-20-brief-agent-p1a-live-fetch.md`）。  
前序：`docs/superpowers/specs/2026-11-19-brief-agent-design.md`（P0 已实现）。  
顺序：P1 按 A→B→C→D→E 依次落地；本稿只覆盖 **A**。

## 1. 背景与目标

P0 的 `fetch_product_pages` 只读 `data/mock-de.json`。P1-A 增加可切换的德国站搜索页真源，复用 selection-agent 的 DE 搜索 HTML 解析思路，不改 tah 核心包。

**一句话：** `BRIEF_SOURCE=mock|live`（默认 `mock`）。`live` 时用 amazon.de 搜索 HTML 填标题/欧元价（及能读到的评分/评论数元数据）；bullets、reviewSnippets、rank 读不到则空/`null`，进 gaps，不编造。

**明确不做（本刀）：** 商品详情 `/dp`、内置浏览器补页、多站点、定时 pull plugin、改 DefaultLoop / Super-agent。

## 2. 成功标准

1. `BRIEF_SOURCE=mock`（或不设）：现有 `pnpm eval` 原 5 条全绿。  
2. `live` + fixture HTML：已知 ASIN 能产出 `priceEur` 有限、`title` 非空的 `ProductPage`；bullets 可空并在 gaps 说明。  
3. live 被挡 / 解析失败：记入 `failures[]`，不装作整批成功；其余目标继续。

## 3. 架构

```
resolve_targets
      │
      ▼
fetch_product_pages
      │
      ├─ BRIEF_SOURCE=mock  → MockSource（现逻辑）
      └─ BRIEF_SOURCE=live  → LiveDeSearchSource
              │
              ├─ 按 target 的 query / title / asin 组搜索词
              ├─ curl 拉 amazon.de/s?k=…（对齐 selection pull-de）
              ├─ parseDeSearchHtml（拷入 brief-agent/lib/sources/）
              └─ hit → ProductPage（有价有标题；bullets/reviews 空）
```

### 3.1 PageSource

```ts
type PageSource = {
  name: "mock" | "live";
  fetchPages(
    targets: Array<{ id: string; url?: string; asin?: string; title?: string; query?: string }>,
    opts?: { failIds?: string[] },
  ): Promise<{ pages: ProductPage[]; failures: Failure[] }>;
};
```

- `activeSource()` 读 `process.env.BRIEF_SOURCE`；仅 `live` 启用真源，其它一律 `mock`。  
- **不**依赖 `@…/example-selection-agent`；将 `parseDeSearchHtml` / 欧元解析 / `isBlocked` **复制**到 `examples/brief-agent/lib/sources/`，注释标明来源。  
- live 匹配：优先用 `asin` 在搜索命中里找；无 asin 用 `query` 或 `title` 作 `k=`；对不上 → 该 target 的 failure。  
- `failIds`：仅 mock（及 mock 回归 eval）注入；live 忽略。

### 3.2 ProductPage 映射（live）

| 字段 | live 来源 |
| --- | --- |
| `id` | target.id（稳定）；可把 asin 写入同字段或保留 target.id |
| `title` | 搜索卡片标题 |
| `priceEur` | 欧元现价 |
| `rank` | 始终 `null`（搜索页无可靠 BSR） |
| `bullets` | `[]` |
| `reviewSnippets` | `[]`（评分/评论数若解析到，可放进 evidence detail，不假装成摘录句） |
| `changeNotes` | `[]` |

compose 侧：当 bullets/reviews 为空时，gaps 增加「缺卖点」「缺评论摘录」（按 target 去重表述即可）。

## 4. 错误处理

- HTML 含 captcha / 客服邮箱特征或长度过短：该 query `failures`（message 含 blocked），本轮不重试。  
- curl 超时/失败：failure，不抛垮整批。  
- 解析 0 命中或 ASIN 不匹配：该 target failure。  
- 全员失败：仍允许后续 compose 空壳简报（P0 行为保留）。

## 5. 评测

| 用例 | 断言 |
| --- | --- |
| 原 5 条（mock） | 不设或 `BRIEF_SOURCE=mock` 时仍 5/5 |
| `live-fixture-asin` | fixture HTML + 已知 ASIN → `priceEur` 有限、title 非空；允许 bullets 空 |
| `live-blocked` | blocked fixture → failures 含 blocked 语义，无伪造成功 page |

Eval **不打外网**：live 源接受注入的 `html` / `fetchHtml` 替身或读 `data/fixtures/*.html`。真 curl 仅手工：`BRIEF_SOURCE=live pnpm start`。

## 6. 文件清单

| 路径 | 职责 |
| --- | --- |
| `examples/brief-agent/lib/sources/types.ts` | `PageSource` |
| `examples/brief-agent/lib/sources/mock.ts` | 现 catalog 逻辑 |
| `examples/brief-agent/lib/sources/amazon-de-html.ts` | 自 selection 拷贝解析 |
| `examples/brief-agent/lib/sources/live-de-search.ts` | curl + 匹配 + fixture 入口 |
| `examples/brief-agent/lib/fetch.ts` | 改走 `activeSource()`；工具入参可传 targets 而非仅 ids（若需 asin/query） |
| `examples/brief-agent/data/fixtures/*.html` | 评测 HTML |
| `examples/brief-agent/eval/cases/live-*.json` + `run-eval.ts` | 新用例 |
| `examples/brief-agent/README.md` | `BRIEF_SOURCE` 一行 |
| 本设计 / 原 design P1 条目标记 A 进行中 |

**工具签名：** 若 live 需要 `query`/`asin`，`fetch_product_pages` 应接收 `targets`（resolve 原样）而不只 `ids`；mock 路径从 targets 取 `id` 即可。保持向后兼容：仅传 `ids` 时 mock 仍可用。

## 7. 非目标（重申）

- `/dp` 详情解析、browser_open 补页  
- 定时 pull plugin、多站点  
- 跨 example 运行时依赖 selection-agent  
- 计费、模板、brief diff（P1-B/C/D）、差评清洗（P1-E）
