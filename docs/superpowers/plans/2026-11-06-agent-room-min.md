# 最小 Agent Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地旁路 `AgentRoom`（共享 transcript + TL/成员回合），P0 用可注入的 turn runner 跑通三回合 demo；不改 DefaultLoop / serve 默认交互。

**Architecture:** `packages/agent` 增加纯编排模块 `room.ts`。`runTurn` 通过 `TurnRunner` 回调驱动；`room-session.ts` 提供真 `Session.run` 适配。状态机与可见性按 spec；用户在 `member_running` 时插话入队。

**Tech Stack:** TypeScript、`node:test`、`node:fs` jsonl。

**Spec:** `docs/superpowers/specs/2026-11-06-agent-room-min-design.md`

## Global Constraints

- 不改 `DefaultLoop`、`subagentTool`、serve/TUI 默认路径
- MVP：串行回合；成员默认不可见 `run_subagent`（由 runner/allowlist 约定，Room 不挂该工具）
- 完成态：`kind:"status"` + `done:true` → Room `status:"done"`
- 用户 `post`：仅 `idle` | `tl_thinking` 立即入 transcript；`member_running` 入队
- 提交用 Conventional Commits；不 push；不提交 `.superpowers/`

## File map

| File | Responsibility |
| --- | --- |
| `packages/agent/src/room.ts` | 类型、`createRoom`、`AgentRoom`、可见性、状态机、队列、可选 jsonl |
| `packages/agent/src/room-session.ts` | `createSessionTurnRunner`、prompt/JSON `TurnOutput` 解析 |
| `packages/agent/src/index.ts` | re-export |
| `packages/agent/test/room.test.ts` | 三回合序、可见性、插话队列、done（mock runner） |
| `packages/agent/test/room-session.test.ts` | 真 Session.run + 消息序 eval |
| `packages/agent/scripts/demo-room.ts` | mock / `--session` stub LLM |

---

### Task 1: Room 核心 + 单测

**Files:** Create/Modify as above (except demo).

- [x] 实现 `room.ts`：`createRoom`、`post`、`transcript`、`visibleMessagesFor`、`runTurn`、`step`、`drainUserQueue`
- [x] `TurnRunner` 返回 `{ kind, text, mention?, done? }`；Room 负责 post + 改 meta.status
- [x] 测试：合规三回合子序列；`tl_only` 对 compliance 不可见；member_running 时 user post 入队，result 后才出现
- [x] export from `index.ts`；`node --test --experimental-strip-types test/room.test.ts` 通过

### Task 2: demo-room 脚本

- [x] `scripts/demo-room.ts`：固定 mock TL/compliance 回复，跑 step×N，打印消息并写 `out/rooms/<id>/`
- [x] `node --experimental-strip-types packages/agent/scripts/demo-room.ts` 退出 0

### Task 3: 文档点一下

- [x] spec 状态改为「P0 已实现」；`docs/guide/status.md` 一行提及 Room

### Task 4: Session.run TurnRunner + 消息序 eval

- [x] `room-session.ts`：`buildRoomTurnPrompt` / `parseTurnOutput` / `createSessionTurnRunner`
- [x] `room-session.test.ts`：stub LLM + 真 Session，断言 `user→tl/delegate→compliance/result→tl/status`
- [x] `demo-room.ts --session` 走 Session 路径

---

## Self-review

- Spec 三回合、可见性、队列、done 结构化均有测
- Session 适配与消息序 eval 有测
- 无 serve UI（P2）
- 无改 Loop
