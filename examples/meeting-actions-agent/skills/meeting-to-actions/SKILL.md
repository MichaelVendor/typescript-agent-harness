---
name: meeting-to-actions
description: 把会议转写或纪要整理成行动项；缺负责人时先问用户再落盘。
---

# 会议 → 行动项

1. `extract_actions`（全文）
2. `compose_draft`
3. 若有缺负责人/优先级：内置 `ask_user`（2–5 选项）；再 `confirm_actions`
4. `save_actions`（不要 allowUnowned，除非用户明确说可以无负责人）
5. 回复四块：结论 / 行动项表（贴工具 markdown）/ 待确认 / 缺口