# 跨会话发消息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同 workspace 网页会话间投递系统 notice；非焦点排队；侧栏菜单发起；标未读；不跑 agent。

**Architecture:** `.tah/session-delivers.json` 队列 + `POST /api/sessions/deliver`；resume/切换时 drain emit notice；Sidebar「Send to session…」。

**Tech Stack:** TypeScript serve/host、React Sidebar、localStorage unread、`node --test`。

## Global Constraints

- 不改 `packages/core` / `DefaultLoop`
- 不触发 `session.run`；仅 notice
- Spec: `docs/superpowers/specs/2026-11-23-cross-session-deliver-design.md`
- Worktree: `.worktrees/dsh-parity-p1`，分支 `feat/dsh-parity-p1`

## File map

| File | Role |
| --- | --- |
| `packages/cli/src/serve/session-deliver.ts` | 队列读写 / format notice / drain |
| `packages/cli/src/serve/http.ts` + host resume 路径 | API + drain |
| `packages/web/src/components/Sidebar.tsx` (+ modal) | 菜单 + 弹层 |
| `packages/web/src/unread.ts` / App | session 未读点 |

---

### Task D1: session-deliver 队列 + API

**Files:**
- Create: `packages/cli/src/serve/session-deliver.ts`
- Modify: `packages/cli/src/serve/http.ts`、必要时 `host.ts` / workspaces resume
- Test: `packages/cli/test/session-deliver.test.ts`（+ serve 集成若易）

**Interfaces:**
```ts
export type DeliverItem = { fromSessionId: string; fromTitle?: string; text: string; at: number };
export function deliverPath(cwd: string): string;
export function enqueueDeliver(cwd: string, toSessionId: string, item: DeliverItem): void;
export function drainDelivers(cwd: string, sessionId: string): DeliverItem[];
export function formatDeliverNotice(item: DeliverItem): string; // `[from «title|id»] text`
export const DELIVER_TEXT_MAX = 2000;
```

- [ ] 单测 enqueue/drain/format；自投/空文本校验 helper
- [ ] `POST /api/sessions/deliver`：live（当前 sessionId）emit notice；else enqueue；404/400/503
- [ ] resume/switch session 时 drain + emit
- [ ] Commit — `feat(cli): 跨会话 notice 投递 API`

---

### Task D2: Sidebar「Send to session…」+ 未读

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`、`api.ts`、`App.tsx`（若需接 unread）
- Optional: small modal component

- [ ] 菜单项 + 弹层选目标/输入/Send
- [ ] 成功 markUnread；切会话 clearUnread；session 行未读点
- [ ] Commit — `feat(web): 会话菜单跨会话投递`

---

### Task D3: Docs

- Spec ✅；CHANGELOG；status 可选
- Commit — `docs: 跨会话发消息已实现说明`

---

## Order

D1 → D2 → D3
