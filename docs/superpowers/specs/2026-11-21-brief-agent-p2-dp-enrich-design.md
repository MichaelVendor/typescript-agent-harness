# brief-agent P2-1：DE `/dp` 补页（curl + 浏览器升档）

状态：P2-1 已实现（fixture/eval 绿；真机 Playwright 为 optionalDependency）。  
选定：搜索之后用 **curl `/dp` → 挡了/字段空再 headless Playwright** 补 bullets / reviewSnippets。

## 目标

`BRIEF_SOURCE=live` 时，在现有搜索标题+价之上，尽量补卖点与评论摘录，便于外发简报。缺则 gaps，不编造。

## 流程

1. 现有 `LiveDeSearchSource` 得到 hit（含 asin）+ 价/标题  
2. `enrichFromDp(asin)`：  
   - curl `https://www.amazon.de/dp/{asin}`  
   - `parseDeDpHtml` → bullets / reviewSnippets  
   - 若 `isBlocked` 或（bullets 与 reviews 皆空）且 `BRIEF_BROWSER !== "0"` → Playwright 取 HTML 再 parse  
3. 合并进 `ProductPage`；仍空不额外 failure（靠 gaps）

## 模块

- `lib/sources/amazon-de-dp.ts` — 解析  
- `lib/sources/enrich-dp.ts` — curl + 可选 browser  
- `live-de-search.ts` — 命中后调用 enrich  
- fixture：`data/fixtures/de-dp-*.html` + eval/unit

## 非目标

多站点、订阅、交互式 `browser_open`、改核心包。

## 验收

`pnpm test` + `pnpm eval` + `pnpm typecheck` 绿；fixture 能抽出 ≥1 bullet 或 review。
