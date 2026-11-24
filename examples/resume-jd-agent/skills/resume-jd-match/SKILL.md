---
name: resume-jd-match
description: 简历+JD 匹配；先问用户是否要基于已有证据的改写建议，再落盘。
---

# 简历 × JD 匹配

1. `parse_pair`（用户粘贴的「===简历=== / ===JD===」全文）
2. `match_requirements`（用上一步 `result`）
3. 内置 `ask_user`：是否生成改写建议（yes / no）
4. 选 yes 才 `compose_rewrites`（`match` 用第 2 步 `result`）
5. `save_report`（`includeRewrites` 用第 3 步的选择；yes 时带上第 4 步 `rewrites`；未回答不得调用）
6. 回复四块：匹配摘要 · 匹配表 ·（选了改写才有）改写 · 缺口
