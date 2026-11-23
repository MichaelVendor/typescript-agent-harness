# DSH 对照 P0 收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已落地的 P0 三条体验缺口收成可用：defer worktree 对用户可见、并行 worker 附件有明确 UI 护栏、dead worker 可从侧栏移除。

**Architecture:** 不新开子系统。协议与 `orch.send` / `workersRemove` / `deferUntilSend` 已在 `feat/dsh-parity-p0`；本计划只补 Web 护栏、错误展示与少量文案/状态，以及补测。

**Tech Stack:** 现有 `packages/web` + `packages/cli` serve；`node --test`；code-commit。

**Base branch / worktree:** `feat/dsh-parity-p0` at `.worktrees/dsh-parity-p0`（勿在未合并的 `v1.7` 主工作区直接改）。

**Parent:** `docs/superpowers/plans/2026-11-22-dsh-parity-p0.md`（A–E 已完成）

## Global Constraints

- 不改 `DefaultLoop` / `packages/core`；不做附件跨 worktree 拷贝；不做 OAuth / Code Review / Timeline。
- Commits 走 `~/.cursor/skills/code-commit/SKILL.md`；never push；never `--no-verify`；不提交 `.superpowers/`。
- 每个 Task 后：`pnpm --filter @typescript-agent-harness/web build`（动 cli 则一并 build cli）再声称完成。

## 现状（已有，勿重做）

| 能力 | 已有 |
| --- | --- |
| `deferUntilSend` | `orch.parallel`、HTTP `POST /api/workers/parallel`、`App` 调 `workersParallel({ deferUntilSend: true })` |
| 附件拒非 main | `orchestrator.send`：`attachments are only supported on the main worker` → HTTP 400 |
| Remove API | `POST /api/workers/remove` + `api.workersRemove` |

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `packages/web/src/App.tsx`（Workers 卡） | dead 行加 Remove；并行按钮文案/提示 |
| `packages/web/src/components/Composer.tsx` | 非 main 时禁用附件；可选提示 |
| `packages/web/src/api.ts` / 错误处理 | 确保 400 文案进 notice（若已有通用错误路径则只接线） |
| `packages/cli/test/serve-workers.test.ts` | 附件 400、remove dead 回归（若缺） |
| `packages/web/test/*.ts` | reducer/UI 相关单测（有则扩） |

---

### Task 1: 附件 UI 护栏（非 main）

**Files:**
- Modify: `packages/web/src/components/Composer.tsx`
- Modify: `packages/web/src/App.tsx`（把 `focusId` / `attachmentsAllowed` 传给 Composer）
- Test: 优先扩展现有 web 测；否则 cli `serve-workers` 已有 attachments 400 断言则补 web 组件测或手动清单

**Interfaces:**
- Consumes: `state.focusId`；`focusId === "main" || !focusId` → 允许附件
- Produces: 非 main 时 `+`/拖放/粘贴图片 **disabled**；title/hint：`Attachments only on main worker`

- [ ] **Step 1:** 确认 `serve-workers` 里非 main + `attachmentIds` → 400 且 body 含 `attachments are only supported`（已有则记下；没有则先补 cli 测）

```bash
cd packages/cli && pnpm build && node --test test/serve-workers.test.ts
```

- [ ] **Step 2:** Composer 增加 prop `allowAttachments?: boolean`（默认 `true`）。`false` 时：隐藏或 disable 文件按钮；`uploadFiles` / drop / paste 直接 return；可留一行 muted 提示。

- [ ] **Step 3:** `App` 传 `allowAttachments={!(state.focusId && state.focusId !== "main")}`

- [ ] **Step 4:** 若 send 仍可能带旧 draft ids：切到非 main 时清空 drafts，或 send 前 strip（选更小改动：切 focus 非 main 时 `setDrafts([])` 在 Composer 用 effect）

- [ ] **Step 5:** `pnpm --filter @typescript-agent-harness/web test` + build PASS

- [ ] **Step 6: Commit** — `fix(web): 非 main worker 禁用附件`

---

### Task 2: Dead worker 侧栏 Remove

**Files:**
- Modify: `packages/web/src/App.tsx`（Workers 列表）
- Modify: 如需样式 `packages/web/src/styles.css`（一行 link/按钮即可）
- Test: 手动清单 + 可选：mock `api.workersRemove` 的浅测

**Interfaces:**
- Consumes: `api.workersRemove({ id })`；`w.dead === true`
- Produces: dead 行旁「Remove」→ 调 remove → 列表靠后续 `workers` SSE 更新（若无事件则 `GET /api/workers` 刷新）

- [ ] **Step 1:** 在 dead 的 `worker-row` 旁加 `button`（`type="button"`，`className="link"`），`stopPropagation` 避免误 focus。

- [ ] **Step 2:** `onClick` → `run(api.workersRemove({ id: w.id }))`；失败走现有 `run`/notice 路径。

- [ ] **Step 3:** 仅 `dead` 显示 Remove（活 worker 不做 Stop，避免扩 scope）。

- [ ] **Step 4:** 手动：并行一个 worker → 杀进程或 stop 至 dead → Remove → 列表消失；worktree 目录被 `orch.remove` 清理（已有后端行为）。

- [ ] **Step 5: Commit** — `feat(web): dead worker 可从侧栏移除`

---

### Task 3: Defer worktree 可见性

**Files:**
- Modify: `packages/web/src/App.tsx`（并行按钮文案 + 可选 pending 标记）
- Modify: `packages/cli/src/serve/orchestrator.ts` 仅当 `WorkerInfo` 缺字段时补 `pendingWorktree?: boolean`（若 list/snapshot 已能区分则只做 UI）
- Test: 已有 `orchestrator-worktree-defer.test.ts`；补 web 文案不强制单测

**目标行为:**
- 「新建并行」创建的是 **deferred worktree**（保持 `deferUntilSend: true`）。
- 用户能看出「尚未物化」：在 `WorkerInfo` 上暴露 `pendingWorktree`（或用 `worktree` 有 name 但目录未建的既有信号）。检查 `list()`：deferred 时 `info.cwd` 已是计划路径、`worktree` 已有——若无法区分，给 `WorkerInfo` 加 `pendingWorktree?: boolean`，`snapshot`/SSE `workers` 带出。

- [ ] **Step 1:** 读 `orchestrator.parallel({ deferUntilSend: true })` 返回的 `WorkerInfo`，确认能否区分 pending；不能则加 `pendingWorktree: true` 直到 `materializeWorktree` 后清除，并加一行 orchestrator 测。

- [ ] **Step 2:** Workers 列表：`pendingWorktree` 显示 chip `pending`（或「待首条消息」）。

- [ ] **Step 3:** 按钮文案改为「新建 worktree 并行」或 title：`Creates a worktree on first send`。

- [ ] **Step 4:** 手动：点新建 → 确认 `.tah/worktrees/<name>` 尚不存在 → 发一条消息 → 目录出现。

- [ ] **Step 5: Commit** — `feat(web): defer worktree 状态可见`

---

### Task 4: 文档一句

**Files:**
- Modify: `CHANGELOG.md` Unreleased（三条收尾）
- Modify: `docs/superpowers/specs/2026-11-22-dsh-parity-p0-design.md` 或本计划旁注「P0 polish ✅」

- [ ] **Step 1:** Unreleased 增加 polish 子弹（附件护栏、dead remove、pending chip）
- [ ] **Step 2: Commit** — `docs: P0 收尾说明`

---

## Self-review

| 收尾项 | Task |
| --- | --- |
| 附件护栏 | 1 |
| Dead remove | 2 |
| Defer 可见 | 3 |
| 文档 | 4 |
| 不做拷贝附件 / OAuth / Stop 活 worker | Global Constraints |

## 执行顺序

1 → 2 → 3 → 4
