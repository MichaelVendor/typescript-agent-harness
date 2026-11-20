# brief-agent P1-B：相对上次 brief 变更 diff 设计

状态：P1-B 已实现（`lib/diff-brief.ts` + compose 接入）。  
前序：P0 + P1-A。顺序 A→B→C→D→E。

## 1. 目标

出新简报时，自动在 `out/briefs/*.json` 找 **同一组 `rows[].id`（集合相等）** 的最近一份，对比后在 markdown 增加 **「### 变更」**；无历史则「无上次简报可对比」。

## 2. 接线

- `findPreviousBrief(dir, ids)` + `diffBriefRows(prev, curr)` + 渲染行文案 → `lib/diff-brief.ts`
- `composeBrief` 可选 `previous` / `briefsDir` / `skipDiff`
- 默认：未 `skipDiff` 时在 compose 内 `findPreviousBrief(PROJECT_ROOT/out/briefs, rowIds)`
- `compose_brief` 工具增加可选 `skipDiff: true`（eval 用）

## 3. 对比字段

按 `row.id`：priceEur、bullets、reviewThemes；行新增/消失。

## 4. 评测

`diff-price`、`diff-no-previous`；原 mock eval 用 skipDiff 或隔离 outDir 保持绿。

## 5. 非目标

compare_to 覆盖、单独 diff 文件、模糊 id 匹配、浏览器。
