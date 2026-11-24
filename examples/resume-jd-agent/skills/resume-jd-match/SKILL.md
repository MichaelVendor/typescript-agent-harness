---
name: resume-jd-match
description: 简历+JD 匹配；先问用户是否要基于已有证据的改写建议，再落盘。
---

# 简历 × JD 匹配

1. `parse_pair`（用户粘贴的「===简历=== / ===JD===」全文）
2. `match_requirements`（用上一步 `result`）
3. 内置 `ask_user`：是否生成改写建议（yes / no）
4. 选 yes 可先 `compose_rewrites` 预览（`match` 用第 2 步 `result`）；落盘改写由 `save_report` 自算
5. `save_report`（入参仅 `match` + `includeRewrites`；`includeRewrites` 用第 3 步的选择；未回答不得调用）
6. 回复四块：匹配摘要 · 匹配表 · 改写 · 缺口。匹配表与改写直接用 `save_report` 返回的 `markdown`，不重画；`includeRewrites` 为 false 时第三块写「已跳过」
