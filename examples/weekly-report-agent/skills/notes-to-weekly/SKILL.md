---
name: notes-to-weekly
description: 把本周杂记整理成周报；先让用户选 ops 或 exec 模板再落盘。
---

# 杂记 → 周报

1. `extract_items`（全文）
2. `compose_draft`
3. 内置 `ask_user`：选 `ops`（细表）或 `exec`（管理层一页）
4. `render_report`（`template` 用上一步的选择）
5. `save_report`（同一 `template`；未选定不得调用）
6. 回复三块：摘要 · 周报正文（贴 `render_report` 的 markdown）· 缺口
