# Super-agent（从 Agent Room 演进）设计草稿

状态：S1–S4 已实现（旁路 `createSuperAgent` … + serve 只读工单：`tah serve --super-agent-panel <persistDir>` → `GET /api/super-agent/panel` + 侧栏「工单」；**`tah serve --super-agent`** 网页内嵌聊，本地 `web:` channel，默认 chat 不变）。渠道 P0 见 channel-host 设计。对照 DeepSeek Super-agent；**不改 DefaultLoop**。  
前序：`docs/superpowers/specs/2026-11-06-agent-room-min-design.md`（P0 Room 已实现）。Room 并行保留。

## 背景

Agent Room 解决的是：**同一 transcript 里多角色轮流说话**（TL 委派 → 成员 result → TL 收口）。  
Super-agent 要解决的是：**人的注意力不够管多个 session**——任务应跨会话持续、可并行、可被事件唤醒，而不是用户亲手开一堆 chat。

| | Agent Room（现状） | Super-agent（目标） |
| --- | --- | --- |
| 单位 | 一间 Room、共享 transcript | 一个常驻 Router + 多个 Worker 工单 |
| Session | 每角色一轮 `Session.run` | Worker = 独立 Session（+ 可选目录） |
| 调度 | 串行回合状态机 | Router 派 Ticket；同 Thread 可订阅直达 Worker |
| 对外 | demo / 旁路 API | 渠道事件进、结果回原对话（PR / 面板） |
| 人设 | TL + compliance… | Router 少工具；Worker 全工具 |

原则保留：**单个 Session/Loop 仍只服务一个说话者**；Super-agent 是旁路控制面。

## 目标 / 非目标

### 目标（分期）

1. **Router / Worker 两层**：Router 收人话与事件、判意图、派工、对外回复；Worker 隔离执行。  
2. **Mandate + Ticket**：一次授权（范围/预算）→ 工单；重试不另开权限。  
3. **Thread 订阅**：同一主题后续事件可直达已绑定 Worker（少绕 Router）。  
4. **可复盘**：Mandate / Ticket / 事件 / Worker transcript 可落盘、可 eval。  
5. **渐进替换 Room**：Room 的「TL/成员回合」映射为 Router 派单 + Worker 跑完回报；demo 从 `demo-room` 迁到 `demo-super-agent`。

### 非目标（本稿）

- 改 `DefaultLoop`、替换 `run_subagent` 语义。  
- 完整飞书/GitHub 生产接入（可先 mock Source）。  
- 跨仓多租户、计费、强文件锁。  
- 云端「算力/状态/环境」三分离（essay 方向，不进 MVP）。

## 核心概念

```ts
type MandateId = string;
type TicketId = string;
type ThreadId = string; // 如 github:pr/12 或 room:thread/…
type WorkerId = string;

/** 不可变授权：范围 + 成本上限 + 策略版本 */
type Mandate = {
  id: MandateId;
  scope: string;          // 人话：允许做什么
  budget?: { maxSteps?: number; maxUsd?: number };
  policyVersion: string;
  createdAt: string;
};

/** 一次授权下的工作单元；重试共用同一 Ticket */
type Ticket = {
  id: TicketId;
  mandateId: MandateId;
  threadId?: ThreadId;
  goal: string;
  status: "queued" | "running" | "done" | "failed" | "needs_human";
  workerId?: WorkerId;
  createdAt: string;
};

type SuperAgentEvent =
  | { kind: "user_message"; text: string; channel: string }
  | { kind: "source_event"; source: string; threadId: ThreadId; text: string }
  | { kind: "worker_report"; ticketId: TicketId; text: string; done?: boolean };

type RouterAction =
  | { type: "reply"; text: string }
  | { type: "spawn_ticket"; goal: string; mandateId?: MandateId; threadId?: ThreadId }
  | { type: "subscribe"; ticketId: TicketId; threadId: ThreadId }
  | { type: "ask_human"; text: string };
```

### 映射（Room → Super-agent）

| Room | Super-agent |
| --- | --- |
| `tl` 回合 | Router 决策（可仍用 `Session.run`，工具极少） |
| `delegate` + mention | `spawn_ticket` → 起 Worker Session |
| 成员 `result` | `worker_report` |
| `status` + `done:true` | Ticket `done` + Router 对外 `reply` |
| Room transcript | Router inbox + 按 Thread 归档；Worker 自有 messages |
| `createSessionTurnRunner` | Worker runner；Router 另配 allowlist |

## 架构（逻辑）

```
  GitHub / 飞书 / 用户聊 ──事件──▶ ┌─────────────┐
                                   │   ROUTER    │ 常驻：过滤 → 意图 → Mandate
                                   │  (Session)  │ 派 Ticket / 对外回复 / 要人确认
                                   └──────┬──────┘
                         派工 / 订阅        │        Worker 回报
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
        ┌──────────┐                ┌──────────┐                ┌──────────┐
        │ WORKER A │ Session+dir    │ WORKER B │                │ WORKER C │
        └────┬─────┘                └────┬─────┘                └────┬─────┘
             │                           │                           │
             └─────────── PR / 结果 ──────┴──────▶ 原对话 / 人审面板 ◀─┘

  共享：Mandate · Ticket · Thread · Subscription · Watchdog(可选)
```

详图见生成图：对话附件 `tah-super-agent-architecture`。

## 状态机（MVP）

1. 事件进入 → **代码过滤**（来源/白名单）→ 可选 **Router 模型判意图**。  
2. 需实施 → 有 Mandate？无则 `ask_human` 或默认 demo Mandate。  
3. `spawn_ticket` → 起 Worker（`SESSION.create` + 目标 prompt）→ `running`。  
4. 若带 `threadId` → 登记 Subscription；同 Thread 后续事件直达该 Worker。  
5. Worker `done` → Router 汇总 → `reply`；`needs_human` → 面板/消息。  
6. Watchdog（P2）：超时 Ticket → failed 或 ask_human。

## 与现有代码落点

| 现有 | 演进 |
| --- | --- |
| `packages/agent/src/room.ts` | 保留；上层加 `super-agent.ts`（Router 编排），Room 可作「单 Thread 对话视图」或逐步 deprecated |
| `room-session.ts` | 抽出通用 `createBoundTurnRunner`；Router/Worker 共用 |
| `demo-room.ts` | 旁路保留；新增 `demo-super-agent.ts` |
| serve UI | P2 才做「工单面板」；默认 chat 不变 |

## 分期

| 阶段 | 交付 |
| --- | --- |
| **S0** | 设计定稿 + 架构图 + 计划（本文） |
| **S1** | 内存 SuperAgent：mock 事件 → Router 派 1 Worker → 回报 → reply；单测消息/工单序 |
| **S2** | ✅ Mandate/Ticket 快照持久化 + restore；失败/Watchdog 超时 |
| **S3** | ✅ mock GitHub Source；`reviewPanel()`；`eval-super-agent.ts` |
| **S4** | ✅ serve 只读工单面板（`--super-agent-panel`） |
| **渠道 P0** | ✅ `tah channel-host` + Telegram/Slack/飞书（见 `2026-11-18-channel-host-design.md`）；钉钉/企微仍 📐 |

## 开放问题（已锁 / 遗留）

1. Router deny 写/exec：✅ `SUPER_AGENT_ROUTER_DENIED_TOOLS` + permissions  
2. Worker 目录：S1/S3 同 cwd；worktree 仍 📐  
3. Room API：并行保留  
4. selection-agent 演示工单：应用层，不阻塞
