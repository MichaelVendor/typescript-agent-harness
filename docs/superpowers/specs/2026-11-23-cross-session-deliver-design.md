# 跨会话发消息（网页会话 → 网页会话）

状态：✅ 已实现（计划见 `docs/superpowers/plans/2026-11-23-cross-session-deliver.md`；分支 `feat/dsh-parity-p1`）

DSH 对照剩余能力之一。同 workspace 内把一条 **系统 notice** 投到另一会话；标未读；**不**自动跑 agent。不改 `DefaultLoop` / `packages/core`。

系列顺序：① 本文 → ② AgentTeam UX → ③ GitLab MR。

## 目标

1. 侧栏会话 ⋯「Send to session…」选目标 + 短文本。
2. `POST /api/sessions/deliver`：焦点会话 live emit notice；非焦点写入队列，resume/切换时 drain。
3. 目标会话标未读（复用 `tah.unread.*` + sessionId）。

## 非目标

- Worker ↔ main、斜杠 `/send`、跨 folder/workspace、IM 渠道。
- 把投递内容当 user 消息入队或触发 `session.run`。
- AgentTeam / GitLab（另开 design）。

## 原则

| 项 | 选择 |
| --- | --- |
| 形态 | 系统 `HostEvent` notice，文案带源会话 |
| 持久 | 非焦点 → `.tah/session-delivers.json` 队列 |
| 未读 | web `markUnread` / `clearUnread`（sessionId） |
| 引擎 | 不改 DefaultLoop |

## 方案

**A：** deliver API + 旁路队列 + 菜单 UI（已选）。不用临时 resume 闪切，不用纯 localStorage 假转录。

## 数据 / API

```ts
// POST /api/sessions/deliver
{ toSessionId: string; text: string }
→ { ok: true; delivered: "live" | "queued" }
```

- `text` trim 非空，上限 ~2000 字符。
- 投给当前焦点 session → `emit({ type: "notice", text: "[from «title|id»] …" })` → `live`。
- 否则 append `.tah/session-delivers.json`：
  `{ [toSessionId]: { fromSessionId, fromTitle?, text, at }[] }` → `queued`。
- 切换 / `resume` 到目标前 **drain** 该 id 的队列并逐条 emit notice。
- 投自己 → 400；未知 id → 404；`--no-persist` → 503。

## UI

- Sidebar 会话菜单：「Send to session…」→ 弹层（同 workspace 列表排除当前 + textarea + Send）。
- 成功：短 note；非当前目标 → `markUnread(origin, toSessionId)`；侧栏 session 行显示未读点（最小改动接现有 unread）。
- 进入目标 → `clearUnread`；转录出现 drained notices。

## 验收

- live / queued 单测；切到目标可见 notice；无 agent turn。
- 非法输入 4xx；DefaultLoop / core 无变更。

## 实现分期（计划占位）

1. 队列读写 + deliver API + drain on resume  
2. Web 菜单 / 弹层 + unread  
3. Docs / CHANGELOG  

## 与已有文档

| 文档 | 关系 |
| --- | --- |
| P1 unread | sessionId 未读点复用 store |
| parallel-sessions | 本迭代不做 worker 投递 |
| AgentTeam / GitLab | 后续两项 |
