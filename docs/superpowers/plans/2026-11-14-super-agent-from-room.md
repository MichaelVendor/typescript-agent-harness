# Super-agent（Room 演进）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在旁路层用 Router/Worker + Mandate/Ticket 替换「仅群聊 Room」叙事，跑通 mock 事件 → 派工 → 回报 → 对外回复，且不改 DefaultLoop / serve 默认交互。

**Architecture:** 新建 `packages/agent/src/super-agent.ts` 编排；复用 `createSessionTurnRunner` 思路分别为 Router/Worker 建 Session。Room 代码保留并行。持久化可选 jsonl（对齐 Room）。

**Tech Stack:** TypeScript、`node:test`、既有 `SESSION` / `Runtime` / stub LLM。

**Spec:** `docs/superpowers/specs/2026-11-14-super-agent-from-room-design.md`

## Global Constraints

- 不改 `DefaultLoop`、`subagentTool`、serve/TUI 默认路径
- S1：串行一个 Worker；Router deny 写文件/exec（permissions）
- Ticket 完成靠结构化字段或约定 JSON（同 Room `done:true`）
- 提交 Conventional Commits；不 push 除非用户要求；不提交 `.superpowers/` / `out/`

## File map

| File | Responsibility |
| --- | --- |
| `packages/agent/src/super-agent.ts` | Mandate/Ticket/Thread、`createSuperAgent`、ingest、dispatch、watch |
| `packages/agent/src/super-agent-session.ts` | Router/Worker prompt + parse RouterAction / WorkerReport |
| `packages/agent/src/index.ts` | re-export |
| `packages/agent/test/super-agent.test.ts` | 工单序 + 订阅直达 |
| `packages/agent/scripts/demo-super-agent.ts` | mock 三步 demo |
| `docs/guide/status.md` | 一行提及（发版时） |

---

### Task 1: 类型 + 内存 SuperAgent 骨架

**Files:** `super-agent.ts`、`index.ts`、失败测试先写

- [x] 定义 `Mandate` / `Ticket` / `SuperAgentEvent` / `createSuperAgent` API（见 spec）
- [x] `ingest(event)`：入队；`step()`：推进 Router 或当前 Worker 一轮
- [x] 测试：无 LLM 时用注入 `routerDecide` / `workerRun` mock，断言 spawn → running → done → reply 序
- [x] `node --test --experimental-strip-types test/super-agent.test.ts` 绿

### Task 2: 真 Session runner（stub LLM）

**Files:** `super-agent-session.ts`、扩展测试

- [x] `buildRouterPrompt` / `parseRouterAction`（JSON：`reply` | `spawn_ticket` | `ask_human`）
- [x] `buildWorkerPrompt` / `parseWorkerReport`（`{ text, done? }`）
- [x] `createSessionSuperAgentRunners` 可挂真 Session
- [x] stub LLM 测试：用户一句话 → spawn → worker done → reply
- [x] Router Runtime：`SUPER_AGENT_ROUTER_DENIED_TOOLS` + permissions deny 测通（挂写工具时）

### Task 3: Thread 订阅

- [x] `spawn_ticket` 带 `threadId` 时登记 subscription
- [x] 同 `threadId` 的 `source_event` **不**经 Router，直达绑定 Worker（测断言 Router 调用次数不增）
- [x] 无订阅的事件仍走 Router

### Task 4: demo + 文档点一下

- [x] `scripts/demo-super-agent.ts`（mock / `--session` / `--github`）退出 0，写 `out/super-agent/<id>/`
- [x] spec 状态改为「S1–S3 已实现」；`status.md` 旁路一行
- [x] 不删 `room.ts`；`super-agent.ts` 头注释标明与 Room 关系

### Task 5: S2/S3（已并入）

- [x] Mandate/Ticket/subscriptions/panel 快照持久化 + `restore`
- [x] Watchdog `ticketTimeoutMs`；Worker throw → `failed`
- [x] `createMockGitHubSource`；`reviewPanel()` 人审只读 API
- [x] `scripts/eval-super-agent.ts`
- [x] S4：`GET /api/super-agent/panel` + `--super-agent-panel` + 侧栏 `ReviewTicketsPanel`（只读；不改 DefaultLoop）

---

## Self-review

- Spec 两层调度、Ticket、订阅、持久化、超时/失败、mock GitHub、面板均有测
- 无改 Loop / 默认 serve
- Room 并行保留
