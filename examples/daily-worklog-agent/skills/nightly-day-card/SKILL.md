---
name: nightly-day-card
description: 采集 git / Cursor / 浏览器当天活动，合成 bundle，只依据 bundle 写摘要并落盘日卡。
---

# 夜间日卡

1. 确定日期（用户给定，否则今天，`YYYY-MM-DD`）
2. `collect_git` · `collect_cursor` · `collect_browser`（各传 `date`）
3. `compose_bundle`（三源结果 + 各自 `gaps`）
4. 只依据 bundle 写 3–6 行摘要；不得出现 bundle 外的 URL / commit hash
5. `save_day_card`（`bundle` + `summary`）
6. 回复：摘要 · 日卡路径 · 缺口
