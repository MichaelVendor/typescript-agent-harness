# Channel Host（Super-agent IM 适配）设计

状态：P0 已实现（`@typescript-agent-harness/channels` + `tah channel-host`；Telegram / Slack / 飞书；`--mock-channel` 可本地测）。钉钉 / 企微 = P1。GitHub 真 webhook 另线（已有 mock Source）。

## 目标

把常见工作 IM 的消息变成 Super-agent 事件：`ingest` → `step` → 工单；Router `reply` / `ask_human` 回原会话。可选把 `persistDir` 挂到 `tah serve --super-agent-panel` 看侧栏。

## 非目标

- 改 DefaultLoop / `POST /api/send`
- 多租户 / 多人审按钮写回 Ticket（面板仍只读）
- 钉钉 / 企业微信 / Teams（P1）

## 架构

```
Telegram | Slack | 飞书
    → ChannelAdapter (packages/channels)
    → tah channel-host
    → createSuperAgent (+ Session runners)
    → persistDir/panel.json
    → outbound send → 原 IM
```

## threadId

| 渠道 | 格式 |
| --- | --- |
| Telegram | `tg:chat/{id}` / `tg:chat/{id}:topic/{topic}` |
| Slack | `slack:{team}:{channel}:{thread_ts\|ts}` |
| 飞书 | `feishu:chat/{chatId}:msg/{rootId\|messageId}` |

已订阅的 `threadId` 入站一律 `source_event`（直达 Worker）。

## 配置

- **可视化**：网页 Settings → Messaging 开关 + Token（密钥进 `~/.tah/settings.json`，只回 `keyHint`；开关进当前目录 `tah.channels.json`）。**保存即热挂/热卸 IM**，无需重启 serve。
- **文件 / env**：`tah.channels.json` + env（`TELEGRAM_BOT_TOKEN`、`SLACK_*`、`FEISHU_*`）；env 优先于 Settings 密钥。
- 文件夹已启用任一渠道时，`tah serve` **自动**打开 Super-agent 互通（不必手写 `--super-agent`）。

HTTP hooks（Slack/飞书）：`127.0.0.1:7430` → `/hooks/slack`、`/hooks/feishu`。Telegram 默认 long-polling。

## 用法

```bash
# 网页 + IM 互通（同一 Super-agent；tah.channels.json 启用 telegram 时同进程挂 bot）
tah serve --super-agent                 # 真 LLM；网页聊会镜像到已配对的 TG
# 配对：先在 TG 给 bot 发一条，或配置 channels.telegram.mirrorChatId
# 勿再另开 channel-host（会抢 getUpdates）

tah serve --super-agent --mock          # mock LLM
tah channel-host                        # 仅 IM、不要网页内嵌时
tah serve --super-agent-panel .tah/super-agent   # 仅只读工单侧栏
```

`--super-agent` 内嵌 Super-agent：网页 `web:` channel +（若配置启用）Telegram/Slack/飞书；网页↔IM 镜像；侧栏默认 `.tah/super-agent`。默认 `tah serve` 仍走 DefaultLoop。

### 桌面端

打开项目时：若 `tah.channels.json` 启用了任一渠道，App 会并行起 `tah channel-host`，且 serve 自动带 `--super-agent-panel`（见 `docs/design/desktop.md`）。项目 `.env` + 登录 shell 环境需能读到 bot token / LLM key。网页内嵌聊请用 CLI：`tah serve --super-agent`。
