# brief-agent P2-3：weekly 后推 TG/飞书

状态：P2-3 已实现。  
选定：**B** — `pnpm weekly` 成功后按 `BRIEF_NOTIFY` 推摘要。

## 配置

- `BRIEF_NOTIFY=telegram,feishu`（空=不推）
- TG：`TELEGRAM_BOT_TOKEN` + `BRIEF_TG_CHAT_ID`
- 飞书：`BRIEF_FEISHU_WEBHOOK`

## 非目标

Super-agent 工单、channel-host、双向对话。
