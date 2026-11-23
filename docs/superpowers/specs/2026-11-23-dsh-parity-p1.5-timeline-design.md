# DSH 对照升级（P1.5）— Timeline 任务树

状态：📐 已设计（待计划 / 实现）

在 P1（未读 / Code Review / GitHub OAuth / 钉钉·企微）之上，对照 DeepSeek Harness 任务树的最小切片。**不**换 `packages/core`、**不**改 `DefaultLoop`、**不**引入 NestJS / Cordis。

前序：`docs/superpowers/specs/2026-11-23-dsh-parity-p1-design.md`（✅）。

## 目标

1. **右栏工单摘要** — 保留现有 `needs_human` / `running` 列表；条目可点。
2. **Timeline 页签** — 主区 Chat | Timeline 切换，展示 Super-agent **全量** Ticket 分组树；只读展开详情。
3. **栏 → 页联动** — 点右栏条目切到 Timeline 并高亮对应工单。

## 非目标

- AgentTeam UX、跨会话发消息、GitLab MR、飞书 OAuth（其它 P1.5 条目另开）。
- 人审写回、标已读、Router 操作按钮。
- 把并行 `agent-worker` 混进同一棵树。
- 从 `events.jsonl` 做事件级时间线产品。
- 独立 `GET /api/super-agent/timeline`（本迭代扩展现有 panel）。

## 原则

| 项 | 选择 |
| --- | --- |
| 数据源 | 仅 Super-agent Ticket（`--super-agent` / `--super-agent-panel`） |
| API | 扩展 `ReviewPanelSnapshot` + 现有 `GET /api/super-agent/panel` |
| 交互 | 只读展开；不跳会话 |
| UI | 右栏摘要 + 主区 Timeline 页签 |

## 方案选定

扩展现有 `reviewPanel()` / `panel.json`，加全量 `tickets[]`；右栏与 Timeline 共用同一 poll。不新开 HTTP、不读 events 流。

## 数据 / API

```ts
type ReviewPanelSnapshot = {
  agentId: string;
  status: SuperAgentStatus;
  needsHuman: Ticket[];
  running: Ticket[];
  /** 全量工单，按 createdAt 新→旧 */
  tickets: Ticket[];
  recentReplies: string[];
  subscriptions: { threadId: ThreadId; ticketId: TicketId }[];
};
```

- `SuperAgent.reviewPanel()` 写入 `tickets:` 当前 `_tickets` 的稳定排序副本（`createdAt` 降序）。
- 持久化 `panel.json` 随 `reviewPanel()` 更新。
- `readSuperAgentPanel`：若缺 `tickets`，回退为 `needsHuman ∪ running`（去重），旧文件可读。
- Ticket 字段不新增必填项；UI 使用已有：`id`、`goal`、`status`、`createdAt`、`startedAt?`、`lastReport?`、`failReason?`、`threadId?`。

## UI

### 右栏

- 继续 `ReviewTicketsPanel`：待人审 / 进行中（截断）+ 最近回复。
- 工单行可点击 → 父级切主区为 Timeline，并传入 `highlightId`。

### Timeline 页签

- 仅 `info.superAgentPanel === true` 时显示 **Chat | Timeline** 切换（默认 Chat）。
- 分组顺序：`needs_human` → `running` → `queued` → `done` → `failed`；空组不渲染或折叠。
- 组内按 `createdAt` 新→旧。
- 行：status 徽章 + goal 截断；点击展开只读详情（全文 goal、时间戳、lastReport、failReason、threadId 文本，**不**导航会话）。
- `highlightId`：滚动到该行、短暂高亮后清除。
- 空态：`tickets.length === 0` →「暂无工单」；panel 错误 → 页内短错误，Chat 不受影响。
- 无 Super-agent：不显示 Timeline 入口。

## 验收

- `reviewPanel()` 含全量 `tickets`；旧 panel 无该字段时 serve 仍 200。
- `--super-agent --mock`：running / needs_human / done 右栏与 Timeline 一致；展开字段齐全。
- 点右栏 → Timeline 高亮对应行。
- 无 `--super-agent`：无 Timeline 入口；DefaultLoop chat 不变。
- 单测：`reviewPanel` 形状；`readSuperAgentPanel` 缺 `tickets` 回退；可选 web 分组 helper。

## 与已有文档关系

| 文档 | 关系 |
| --- | --- |
| P1 design | 底座已落地；本文不重复 OAuth / Review / 渠道 |
| Super-agent S4 | 工单面板从「摘要列表」演进为「摘要 + Timeline」 |
| P1.5 其它条目 | AgentTeam / 跨会话 / GitLab / 飞书 OAuth — 另开 design |

## 实现分期（计划稿占位）

1. Agent：`tickets` 进 `reviewPanel` + 单测  
2. CLI：`readSuperAgentPanel` 兼容  
3. Web：Timeline 页签 + 栏点击联动  
4. Docs：status / CHANGELOG 一行  
