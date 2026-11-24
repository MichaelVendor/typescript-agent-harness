# AgentTeam UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tah serve --room` 提供 Room 群聊页 + Settings Team 建队（`tah.team.json`），复用 `createRoom`。

**Architecture:** team.json 读写 API；serve 内嵌 AgentRoom + mock/real turnRunner；web Chat|Room + Settings Team 卡。

**Tech Stack:** TypeScript、createRoom、serve http、React、`node --test`。

## Global Constraints

- 不改 core / DefaultLoop
- Spec: `docs/superpowers/specs/2026-11-24-agent-team-ux-design.md`
- Worktree: `.worktrees/dsh-parity-p1`，`feat/dsh-parity-p1`
- `--room` 才有 Room HTTP/页签；Team Settings 始终可编辑

## File map

| File | Role |
| --- | --- |
| `packages/cli/src/team-settings.ts` | load/save tah.team.json + defaults |
| `packages/cli/src/serve/room-host.ts` | embed AgentRoom |
| `packages/cli/src/serve/http.ts` / `args.ts` / `run.ts` | --room + routes |
| `packages/web/.../TeamSettings.tsx` / `RoomView.tsx` / App | UI |

---

### Task R1: tah.team.json + Settings API

**Files:** `team-settings.ts`；http GET/POST `/api/settings/team`；protocol；tests

- [x] 默认 tl+researcher；校验必有 tl
- [x] Commit — `feat(cli): Team 配置 tah.team.json`

---

### Task R2: serve Room embed + HTTP

**Files:** `room-host.ts`；args `--room`；info.room；GET/POST room routes；mock turnRunner when `--mock`

- [x] goal / message / step / get snapshot
- [x] persist `.tah/room`
- [x] Commit — `feat(cli): serve --room 内嵌 AgentRoom`

---

### Task R3: Web Room + Team Settings UI

**Files:** RoomView、TeamSettings、Settings section、App 顶栏、api.ts

- [x] Chat|Room（+ Timeline 若有）
- [x] Settings Team 卡
- [x] Commit — `feat(web): Room 页与 Team 设置`

---

### Task R4: Docs

- [x] Spec ✅；CHANGELOG；status
- [x] Commit — `docs: AgentTeam UX 已实现说明`

---

## Order

R1 → R2 → R3 → R4
