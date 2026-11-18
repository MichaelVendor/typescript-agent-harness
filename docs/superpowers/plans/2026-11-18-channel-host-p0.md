# Super-agent IM 渠道适配（P0）Implementation Plan

> 执行副本。权威勾选以仓库实现为准。

**Goal:** Telegram / Slack / 飞书 → Super-agent 工单；`tah channel-host` 常驻。

**Defaults:** P0 三渠道；宿主 `tah channel-host`；不改 DefaultLoop。

## Tasks

- [x] Task 1: `packages/channels` 骨架 + mock + 测
- [x] Task 2: `tah channel-host` mock 闭环
- [x] Task 3: Telegram 适配器
- [x] Task 4: Slack 适配器
- [x] Task 5: 飞书适配器
- [x] Task 6: spec / plan / status

## 非目标

钉钉/企微、多租户、人审按钮写回、嵌进 `tah serve` 聊天。
