# DSH 对照升级（P0）Implementation Plan

> **Land status:** Phase **A–D** 已在分支 `feat/dsh-parity-p0` 落地；下方 Task 勾选保留作执行记录，不必逐条改勾。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按推荐顺序落地 Worktree 并行会话、会话状态面、连接器账号层（token）、MCP 工具按需暴露——对齐 DSH 工作流，不换框架。

**Architecture:** 不动 `packages/core` / `DefaultLoop`。A 用已有 parallel-sessions 规格（父 serve + `agent-worker` + worktree）。B 读 orchestrator/HostEvent 做只读状态 API + 右栏。C 在 `~/.tah` 增加账号存储并迁移 Messaging 密钥。D 给 `mcpPlugin` 增加 `lazy` 暴露模式。

**Tech Stack:** 现有 TypeScript monorepo、`node:http` + SSE、`ChatHost` / `HostEvent`、React web、`node --test --experimental-strip-types`、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-11-22-dsh-parity-p0-design.md`

## Global Constraints

- **不改** `DefaultLoop`、`packages/core` Plugin 作用域模型、不引入 NestJS/Cordis。
- Commits 走 `~/.cursor/skills/code-commit/SKILL.md`；never push；never `--no-verify`；不提交 `.superpowers/`、`tah.channels.json` 密钥、`.env`。
- 每个 Task 结束后：相关包 `pnpm --filter <pkg> build`（动 web 时一并 build web）再声称完成。
- A 的权威实现步骤以 `docs/superpowers/plans/2026-10-28-parallel-sessions.md` 为准；本文件只加对照增量与后续 Phase。

## 文件结构（整包）

| 文件 | 职责 |
| --- | --- |
| （A）见 `2026-10-28-parallel-sessions.md` 文件表 | worker / orchestrator / worktree |
| `packages/cli/src/serve/session-status.ts` | 组装状态快照 |
| `packages/cli/src/serve/http.ts` | `GET /api/session-status` |
| `packages/web/src/components/SessionStatus.tsx` | 右栏状态 UI |
| `packages/cli/src/connectors.ts` | 账号读写（0600） |
| `packages/cli/src/settings.ts` / Messaging 路径 | 改走 connectors |
| `packages/mcp/src/plugin.ts` | `toolExposure` eager/lazy |
| `packages/cli/src/runtime.ts` | 传入 MCP 暴露模式 |
| `docs/guide/status.md` / `CHANGELOG.md` | 随发版更新 |

---

## Phase A — Worktree 并行会话

**依赖:** 无  
**主计划:** 完整执行 `docs/superpowers/plans/2026-10-28-parallel-sessions.md`（Task 1 → 完）。  
**规格:** `docs/superpowers/specs/2026-10-28-parallel-sessions-design.md`

### Task A0: 执行 parallel-sessions 主计划

- [ ] **Step 1:** 按 `2026-10-28-parallel-sessions.md` 逐 Task 实现并勾选（本仓库另开 PR/分支亦可）。
- [ ] **Step 2:** 主计划全部勾选且 `pnpm --filter @typescript-agent-harness/cli test` 相关用例通过后，再做 A1–A2。

### Task A1: 延迟创建 worktree（DSH 对照增量）

**Files:**
- Modify: `packages/cli/src/serve/orchestrator.ts`（或主计划落地后的等价文件）
- Test: `packages/cli/test/orchestrator-worktree-defer.test.ts`

**Interfaces:**
- Consumes: 主计划的 `SessionOrchestrator.create({ worktree?: { name, base? }, deferUntilSend?: boolean })`
- Produces: `prepareWorktree(id)` 在首次 `send` 前调用；取消未发送的草稿 → 不调用 `git worktree add`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
// after impl: import { SessionOrchestrator } from "../src/serve/orchestrator.js";

test("defer worktree: no directory until first send", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tah-wt-"));
  execFileSync("git", ["init"], { cwd: repo });
  execFileSync("git", ["commit", "--allow-empty", "-m", "i"], { cwd: repo });
  // orch = new SessionOrchestrator({ repoRoot: repo, ... });
  // const id = await orch.create({ worktree: { name: "feat" }, deferUntilSend: true });
  // assert.equal(fs.existsSync(path.join(repo, ".tah/worktrees/feat")), false);
  // await orch.send(id, "hello");
  // assert.equal(fs.existsSync(path.join(repo, ".tah/worktrees/feat")), true);
  assert.fail("implement SessionOrchestrator defer path");
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @typescript-agent-harness/cli exec node --test --experimental-strip-types test/orchestrator-worktree-defer.test.ts
```

- [ ] **Step 3: Implement defer** — create 只登记 pending；`send`/`open` 首条消息路径调用既有 `worktree.add`；`remove` 未物化则 no-op。

- [ ] **Step 4: Re-run test — expect PASS**

- [ ] **Step 5: Commit** — `feat(cli): worktree 延迟到首条消息再创建`

### Task A2: Orchestrator 只读快照（供 Phase B）

**Files:**
- Modify: `packages/cli/src/serve/orchestrator.ts`
- Test: `packages/cli/test/orchestrator-snapshot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WorkerSnapshot = {
    workerId: string;
    cwd: string;
    busy: boolean;
    attention?: "approval" | "question";
    worktree?: { name: string; branch: string };
  };
  // orch.snapshot(): { focusId: string; workers: WorkerSnapshot[] }
  ```

- [ ] **Step 1: Failing test** — `snapshot()` 含 `main`，`focusId` 默认 `main`。
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `snapshot()`**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `feat(cli): orchestrator 导出 worker 快照`

**Phase A 完成标准:** parallel-sessions 主计划 ✅ + A1/A2 ✅；手动：同一 repo 开两个 worktree session 并行跑一轮。

---

## Phase B — 会话状态面

**依赖:** A2 理想；无 orchestrator 时允许 `main`-only 降级。

### Task B1: `sessionStatus` 纯函数组装

**Files:**
- Create: `packages/cli/src/serve/session-status.ts`
- Test: `packages/cli/test/session-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SessionStatusDto = {
    cwd: string;
    busy: boolean;
    pending: null | { kind: "approval" | "question"; id: string };
    workers: Array<{ workerId: string; busy: boolean; attention?: string }>;
    superAgent?: { ticketCount: number };
  };
  export function buildSessionStatus(input: {
    cwd: string;
    busy: boolean;
    pending: SessionStatusDto["pending"];
    workers?: SessionStatusDto["workers"];
    ticketCount?: number;
  }): SessionStatusDto;
  ```

- [ ] **Step 1: Failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionStatus } from "../src/serve/session-status.js";

test("buildSessionStatus main-only", () => {
  const s = buildSessionStatus({
    cwd: "/tmp/proj",
    busy: true,
    pending: { kind: "approval", id: "a1" },
  });
  assert.equal(s.cwd, "/tmp/proj");
  assert.equal(s.busy, true);
  assert.equal(s.pending?.id, "a1");
  assert.deepEqual(s.workers, []);
});
```

- [ ] **Step 2: Run — FAIL（module missing）**
- [ ] **Step 3: Implement `buildSessionStatus`**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `feat(cli): session-status DTO 组装`

### Task B2: `GET /api/session-status`

**Files:**
- Modify: `packages/cli/src/serve/http.ts`
- Test: 扩展现有 `packages/cli/test/serve.test.ts`（或新建 `serve-session-status.test.ts`）

- [ ] **Step 1: Failing test** — 启动 serve 测试夹具，`GET /api/session-status` 返回 200 且 JSON 含 `cwd`。
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 路由里调用 `buildSessionStatus`；有 orchestrator 则填 `workers`；有 super-agent panel 则填 `ticketCount`。
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `feat(cli): GET /api/session-status`

### Task B3: Web 右栏 Session status

**Files:**
- Create: `packages/web/src/components/SessionStatus.tsx`
- Modify: 工作台布局（现有右栏 / Diff 旁挂载，避免新 dashboard 感）
- Test: 若有 web 单测则加；否则手动清单写入 Step 4

- [ ] **Step 1: 组件渲染 cwd + busy 文案 + workers 列表（空则隐藏）**
- [ ] **Step 2: 首屏 fetch `/api/session-status`；`turn`/`approval` 事件时刷新或局部更新**
- [ ] **Step 3: `pnpm --filter @typescript-agent-harness/web build`**
- [ ] **Step 4: 手动** — `tah serve` 开项目，状态面显示路径；发消息后 busy；有审批时 `pending` 可见
- [ ] **Step 5: Commit** — `feat(web): 会话状态面`

**Phase B 完成标准:** 右栏/停靠区稳定显示焦点 cwd 与 busy；A 落地后显示多 worker。

---

## Phase C — 连接器账号层（token）

**依赖:** 无（可与 B 并行）。OAuth 真流不在本 Phase。

### Task C1: `connectors` 存储

**Files:**
- Create: `packages/cli/src/connectors.ts`
- Test: `packages/cli/test/connectors.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ConnectorAccount = {
    id: string;
    provider: "telegram" | "slack" | "feishu" | string;
    authKind: "token";
    label?: string;
    keyHint: string;
  };
  export function loadConnectors(home: string): { accounts: ConnectorAccount[] };
  export function upsertConnectorToken(
    home: string,
    input: { id?: string; provider: string; token: string; label?: string },
  ): ConnectorAccount;
  export function removeConnector(home: string, id: string): void;
  export function readConnectorSecret(home: string, id: string): string | undefined;
  ```
- 文件：`~/.tah/connectors.json` mode `0o600`；密文字段与 settings 同样不可回传明文。

- [ ] **Step 1: Failing test** — upsert 后 load 只有 `keyHint`；`readConnectorSecret` 返回原 token。
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `feat(cli): connectors 账号存储`

### Task C2: Messaging 读写改走 connectors

**Files:**
- Modify: Settings Messaging 相关 `packages/cli/src/serve/http.ts` / settings 辅助
- Modify: channel-host / super-agent-chat 取 token 路径
- Test: `packages/cli/test/serve-messaging-connectors.test.ts`（或扩展现有 settings 测）

- [ ] **Step 1: Failing test** — POST Messaging token → connectors 有记录；GET settings 仍只见 hint。
- [ ] **Step 2: 双读兼容** — 若 connectors 无、settings 旧字段有，首次读时迁移写入 connectors。
- [ ] **Step 3: channel 启动用 `readConnectorSecret`**
- [ ] **Step 4: 测试 PASS**
- [ ] **Step 5: Commit** — `feat(cli): Messaging 密钥迁到 connectors`

**Phase C 完成标准:** 新装/迁移后 IM 仍能收发；磁盘上密钥集中在 connectors（或已迁移）。

---

## Phase D — MCP 按需暴露

**依赖:** 无（可与 B/C 并行）。

### Task D1: `mcpPlugin` lazy 模式

**Files:**
- Modify: `packages/mcp/src/plugin.ts`
- Modify: `packages/mcp/src/index.ts`（导出类型）
- Test: `packages/mcp/test/lazy-exposure.test.ts`

**Interfaces:**
- Consumes: `McpPluginOptions & { toolExposure?: "eager" | "lazy" }`（默认 `"eager"`）
- Produces（lazy）:
  - 注册只读工具 `mcp_list_tools`：返回该 server 的 name/description 列表（来自 `listTools`，可缓存）。
  - 注册 `mcp_enable_tools`：输入 `names: string[]`，把对应 tool `tools.register`；已注册的跳过。
  - **不**在 `setup` 时把全部 MCP tools 注册进 registry。

- [ ] **Step 1: Failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import { toolPlugin, TOOLS } from "@typescript-agent-harness/tools";
import { mcpPlugin } from "../src/plugin.js";

test("lazy: setup registers discovery tools only", async () => {
  const backend = {
    async listTools() {
      return [{ name: "z_remote", description: "x", inputSchema: { type: "object", properties: {} } }];
    },
    async callTool() { return { content: [{ type: "text", text: "ok" }] }; },
  };
  const rt = new Runtime();
  rt.use(toolPlugin());
  rt.use(mcpPlugin({ backend: backend as never, toolExposure: "lazy", name: "mcp_test" }));
  await rt.start();
  const tools = rt.get(TOOLS);
  const names = tools.list().map((t) => t.name);
  assert.ok(names.includes("mcp_list_tools"));
  assert.ok(!names.includes("z_remote"));
  await rt.stop();
});
```

（工具名以实现为准；若与现有命名冲突，计划实现时固定为 `mcp_list_tools` / `mcp_enable_tools`，测同步改。）

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement lazy 分支；eager 保持今日行为**
- [ ] **Step 4: 补测 enable 后 `z_remote` 出现且可 call**
- [ ] **Step 5: Commit** — `feat(mcp): toolExposure lazy 按需注册`

### Task D2: 配置接线

**Files:**
- Modify: `packages/cli/src/runtime.ts`（读 config/settings → 传给 `mcpPlugin`）
- Modify: `docs/design/config.md` 一行说明
- Test: 小测或 serve 配置测：`mcp.toolExposure: "lazy"` 时启动日志/工具列表不含远程全量名

- [ ] **Step 1: `tah.config.json` 支持 `extensions.mcp.toolExposure` 或顶层约定键（与现有 mcp 配置风格一致，实现时读一处写死）**
- [ ] **Step 2: 默认 eager，旧项目无感**
- [ ] **Step 3: Commit** — `feat(cli): 接线 MCP toolExposure`

**Phase D 完成标准:** lazy 下首轮 LLM tools 无未 enable 的 MCP 远程工具名；eager 回归通过。

---

## Phase E — 文档与发版备忘

- [ ] 更新 `docs/guide/status.md`（能力一行）
- [ ] `CHANGELOG.md` 在实际发版 bump 时写（本计划不强制立刻发版）
- [ ] Spec 状态改为 ✅ 已实现（各 Phase 全绿后）

---

## Self-review

| Spec 项 | Task |
| --- | --- |
| A Worktree | A0 → parallel-sessions + A1/A2 |
| B Session status | B1–B3 |
| C Connector token | C1–C2 |
| D MCP lazy | D1–D2 |
| 不改 core/DefaultLoop | Global Constraints |
| OAuth / Code Review / 未读 | 明确非本计划 |

无 TBD 占位；A0 依赖外部详细计划属有意拆分。

## 执行顺序（推荐）

1. **A0**（最大块）→ **A1** → **A2**  
2. **B1** → **B2** → **B3**  
3. **D1** → **D2**（可与 B 并行）  
4. **C1** → **C2**  
5. **E**
