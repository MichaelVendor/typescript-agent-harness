---
name: competitive-brief
description: 用户给出竞品 URL、ASIN、品牌或类目关键词，需要一份可验收的竞品/市场简报时使用。先收集目标与页面，再抽取信号、规则合成、落盘。不做自动决策、不下单。
---

# 竞品简报

用户已经给出目标。按顺序调用，上一步的返回原样交给下一步。任一步整批不可用就停，说明原因，不要写成已出完整简报。

数字只来自工具。缺字段写「缺数据」，禁止补全价格、评论数、排名。最终回复只贴 `compose_brief` / `save_brief` 产出的 markdown，不重写数字。

1. `resolve_targets`。把用户给的 URL / ASIN / 标题 / 类目词放进 `targets` 或 `query`。`market` 固定 DE。超过 8 个会被截断，记下 `truncated`。
2. `fetch_product_pages`。`ids` 必须来自上一步 `targets[].id`，不要自己编 id。单条失败进 `failures`，其余继续。
3. `extract_signals`。`pages` 原样传入。不要自己补价格、卖点或差评主题。
4. `compose_brief`。`signals` + `failures`（把 fetch 与 extract 的 failures 合并）+ `truncated` 原样传入。不要改字段。
5. `save_brief`。`brief` 原样传入。返回的 `mdPath` / `markdown` 用于回复。
6. 按 `AGENTS.md` 回复格式写出四块：结论、对照表、差评主题、缺口。四块内容只贴工具 markdown，不要另起散文报告。
