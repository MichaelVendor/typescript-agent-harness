# brief-agent P2-2：订阅式每周 brief

状态：P2-2 已实现。  
选定：**A** — `out/subscriptions.json` + `subscribe_targets` + `scripts/weekly-brief.ts`（cron 调）。

## 目标

本地登记要盯的竞品，定时脚本按启用订阅跑完整链路并落盘（brief + tasks）。

## 非目标

云调度、IM 推送（P2-3）、改 tah 核心。
