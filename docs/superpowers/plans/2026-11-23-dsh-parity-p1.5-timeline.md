# DSH P1.5 Timeline 任务树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super-agent 全量工单 Timeline 页签 + 右栏摘要点击联动，对齐 DSH 任务树最小切片。

**Architecture:** 扩展现有 `ReviewPanelSnapshot.tickets` 与 `GET /api/super-agent/panel`；右栏与 Timeline 共用 poll；主区 Chat | Timeline 切换。不改 DefaultLoop / core。

**Tech Stack:** TypeScript monorepo、`packages/agent` SuperAgent、`packages/cli` serve panel、`packages/web` React、`node --test`。

## Global Constraints

- 不改 `packages/core` / `DefaultLoop`
- 仅 Super-agent Ticket 数据源（需 `--super-agent` / panel）
- 只读展开；不跳会话；不新开 timeline HTTP
- Conventional Commits；code-commit 提交流程
- Worktree：`/Users/hongchaoling/Desktop/AgentHarness/.worktrees/dsh-parity-p1`，分支 `feat/dsh-parity-p1`

## File map

| File | Responsibility |
| --- | --- |
| `packages/agent/src/super-agent.ts` | `reviewPanel()` 增加 `tickets` |
| `packages/cli/src/serve/super-agent-panel.ts` | 读 panel 缺 `tickets` 回退 |
| `packages/web/src/timeline.ts` | 分组 helper（status 桶） |
| `packages/web/src/components/TimelineView.tsx` | Timeline 页签 UI |
| `packages/web/src/components/ReviewTicketsPanel.tsx` | 行可点 → highlight |
| `packages/web/src/App.tsx` | Chat \| Timeline 切换 |

---

### Task T1: reviewPanel 全量 tickets

**Files:**
- Modify: `packages/agent/src/super-agent.ts`（`ReviewPanelSnapshot` + `reviewPanel()`）
- Test: `packages/agent/test/super-agent.test.ts`

**Interfaces:**
- Produces: `ReviewPanelSnapshot.tickets: Ticket[]`（`createdAt` 降序）

- [ ] 单测：有 done/running/needs_human 时 `reviewPanel().tickets` 含全量且排序
- [ ] 实现 `tickets` 字段
- [ ] Commit — `feat(agent): reviewPanel 含全量 tickets`

---

### Task T2: readSuperAgentPanel 兼容

**Files:**
- Modify: `packages/cli/src/serve/super-agent-panel.ts`
- Test: `packages/cli/test/super-agent-panel.test.ts`

**Interfaces:**
- Consumes: panel JSON 可缺 `tickets`
- Produces: 始终返回 `tickets` 数组

- [ ] 单测：无 `tickets` 时回退 `needsHuman ∪ running`
- [ ] 实现兼容
- [ ] Commit — `feat(cli): panel 读 tickets 兼容旧文件`

---

### Task T3: Timeline 分组 helper

**Files:**
- Create: `packages/web/src/timeline.ts`
- Test: `packages/web/test/timeline.test.ts`

**Interfaces:**
```ts
export type TimelineGroupId = "needs_human" | "running" | "queued" | "done" | "failed";
export function groupTicketsForTimeline(tickets: { id: string; status: string; createdAt: string; goal: string }[]):
  { id: TimelineGroupId; tickets: typeof tickets }[];
```
- 组序固定；空组省略；组内 `createdAt` 降序

- [ ] 单测分组顺序与空组
- [ ] 实现
- [ ] Commit — `feat(web): Timeline 工单分组`

---

### Task T4: TimelineView + Chat|Timeline + 栏联动

**Files:**
- Create: `packages/web/src/components/TimelineView.tsx`
- Modify: `packages/web/src/components/ReviewTicketsPanel.tsx`（`onSelectTicket?: (id: string) => void`）
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `ReviewPanelSnapshot`、`groupTicketsForTimeline`、`highlightId`
- 仅 `info.superAgentPanel` 显示切换；默认 Chat

- [ ] TimelineView：分组、展开、highlight 滚动
- [ ] 右栏点击 → 切 Timeline + highlightId
- [ ] 无 panel：无入口
- [ ] Commit — `feat(web): Timeline 页签与工单栏联动`

---

### Task T5: 文档

**Files:**
- Modify: `docs/superpowers/specs/2026-11-23-dsh-parity-p1.5-timeline-design.md` 状态 → ✅
- Modify: `CHANGELOG.md` Unreleased
- Modify: `docs/guide/status.md` 一行（可选）

- [x] Commit — `docs: DSH P1.5 Timeline 已实现说明`

---

## Self-review

| Spec | Tasks |
| --- | --- |
| tickets 全量 | T1 |
| 旧 panel 兼容 | T2 |
| 分组树 + 页签 + 栏联动 | T3–T4 |
| 不改 core | Global |
| AgentTeam / GitLab / 跨会话 | 排除 |

**执行顺序:** T1 → T2 → T3 → T4 → T5
