# AgentHost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add headless `tah agent-host` that exposes Bearer-authenticated `/v1` HTTP + `HostEvent` SSE for intranet one-project-one-container use, without changing `tah serve` single-machine behaviour.

**Architecture:** New `packages/cli/src/agent-host/` wraps one `createChatHost` (fixed `cwd`). CP presents Bearer tokens signed with `AR_SHARED_SECRET`. Session routes `resume` when needed; concurrent turns return 409. SSE writes the same `HostEvent` JSON as serve. No cookie, no web static, no Settings/workspaces/browser pane.

**Tech Stack:** TypeScript (NodeNext, strict), `node:http`, `node:crypto` (HMAC), existing `ChatHost` / `HostEvent`, `node --test --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-10-18-agent-host-design.md`

## Global Constraints

- Branch `v1.0`, package version line `1.0.x`. Do not regress `tah serve` / TUI; existing serve tests must stay green.
- Touch only `packages/cli/src/agent-host/**`, `packages/cli/src/{args,cli,index}.ts` (wiring), `packages/cli/test/agent-host*.ts`, docs (`design/agent-host.md`, guide/status, CHANGELOG when shipping the feature). Do not modify `packages/cli/src/serve/**` behaviour except optional shared SSE helper extract that serve can call unchanged.
- P0: no attachment upload, no `/answer`, no queue-while-busy (409 instead), no browser pane.
- Auth: `Authorization: Bearer <token>` only; secret from `process.env.AR_SHARED_SECRET` (required to start).
- Listen default `0.0.0.0:7800` (container); override with `--host` / `--port`.
- Commits via `~/.cursor/skills/code-commit/SKILL.md`; never push; never `--no-verify`; never commit `.superpowers/`.

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `packages/cli/src/agent-host/auth.ts` | 签发校验用 HMAC token（测试可签；生产由 CP 签） |
| `packages/cli/src/agent-host/sse.ts` | 把 `HostEvent` 写成 SSE `data:` 行 |
| `packages/cli/src/agent-host/http.ts` | `/health`、`/v1/*` 路由 |
| `packages/cli/src/agent-host/run.ts` | `startAgentHost`：建 ChatHost、listen、stop |
| `packages/cli/src/args.ts` / `cli.ts` | `tah agent-host` 命令与 flag |
| `packages/cli/test/agent-host-auth.test.ts` | Bearer 单测 |
| `packages/cli/test/agent-host.test.ts` | HTTP 集成（mock LLM） |
| `docs/design/agent-host.md` | 用户可见设计说明（对齐 spec） |

---

### Task 1: Bearer HMAC 鉴权

**Files:**
- Create: `packages/cli/src/agent-host/auth.ts`
- Test: `packages/cli/test/agent-host-auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AgentHostClaims = {
    projectId: string;
    userId: string;
    exp: number; // unix seconds
    sessionId?: string;
  };
  export function signAgentHostToken(secret: string, claims: AgentHostClaims): string;
  export function verifyAgentHostToken(
    secret: string,
    token: string,
    expectedProjectId: string,
    nowSec?: number,
  ): AgentHostClaims; // throws Error with message usable as HTTP 401 body
  ```

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { signAgentHostToken, verifyAgentHostToken } from "../dist/agent-host/auth.js";

test("sign and verify round-trip; rejects bad secret, expiry, wrong project", () => {
  const secret = "test-secret";
  const claims = { projectId: "proj_a", userId: "u1", exp: Math.floor(Date.now() / 1000) + 60 };
  const token = signAgentHostToken(secret, claims);
  assert.deepEqual(verifyAgentHostToken(secret, token, "proj_a"), claims);
  assert.throws(() => verifyAgentHostToken("other", token, "proj_a"), /invalid/);
  assert.throws(() => verifyAgentHostToken(secret, token, "proj_b"), /project/);
  const expired = signAgentHostToken(secret, { ...claims, exp: 1 });
  assert.throws(() => verifyAgentHostToken(secret, expired, "proj_a", 100), /expir/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/agent-host-auth.test.ts`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement auth**

Token format: `base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, payload))`（无第三方 JWT 库）。`verify` 用 `timingSafeEqual` 比签名；`exp < now` 或 `projectId !== expected` 抛错。

- [ ] **Step 4: Run test to verify it passes**

Same command; Expected: PASS

- [ ] **Step 5: Commit**

```bash
# via code-commit skill
git add packages/cli/src/agent-host/auth.ts packages/cli/test/agent-host-auth.test.ts
```

Message style: `feat(cli): AgentHost Bearer HMAC 鉴权`

---

### Task 2: SSE 写入 + `/health` 骨架

**Files:**
- Create: `packages/cli/src/agent-host/sse.ts`
- Create: `packages/cli/src/agent-host/http.ts`（先只 `/health`）
- Create: `packages/cli/src/agent-host/run.ts`（listen + 注入 secret/projectId）
- Test: extend `packages/cli/test/agent-host.test.ts`（新建）

**Interfaces:**
- Produces:
  ```ts
  export function writeHostEvent(res: ServerResponse, event: HostEvent): void;
  // writes: `data: ${JSON.stringify(event)}\n\n`
  export type AgentHostOptions = {
    secret: string;
    projectId: string;
    host: string; // bind address
    port: number;
    flags: CliFlags; // cwd, mock, persist, …
    homeDir?: string;
  };
  export function startAgentHost(opts: AgentHostOptions): Promise<{ url: string; stop(): Promise<void> }>;
  ```

- [ ] **Step 1: Failing test — GET /health without auth returns 200**

用 `startAgentHost` + `fetch`；`AR` 测里 `secret`/`projectId` 固定；`flags.mock: true`、`persist: true`、临时 `cwd`。

```ts
test("GET /health is public", async () => {
  const tmp = await mkdtemp(…);
  const { url, stop } = await startAgentHost({ secret: "s", projectId: "p", host: "127.0.0.1", port: 0, flags: mockFlags(tmp) });
  try {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).projectId, "p");
  } finally {
    await stop();
  }
});
```

- [ ] **Step 2: Implement sse + minimal http + run**（`createServer`，只路由 `GET /health`；其它 404）

- [ ] **Step 3: Tests pass; commit** `feat(cli): AgentHost /health 与 SSE 辅助`

---

### Task 3: Sessions list / create + Bearer 门闸

**Files:**
- Modify: `packages/cli/src/agent-host/http.ts`
- Modify: `packages/cli/test/agent-host.test.ts`

**Interfaces:**
- `requireAuth(req)` → claims；缺/坏 token → 401 `{ error }`
- `GET /v1/sessions` → `host.listSessions()`
- `POST /v1/sessions` body 可选 `{ title? }` → `host.reset()` 后可选 `renameSession`；返回 `{ sessionId }`
- `GET /v1/info` → `{ approve, version, cwd }`

- [ ] **Step 1: Tests**

```ts
test("v1 routes need Bearer; list/create sessions", async () => {
  // no header → 401
  // good token → GET /v1/sessions array
  // POST /v1/sessions → 201 { sessionId } matching host.sessionId
  // wrong projectId in token → 401
});
```

- [ ] **Step 2: Implement; pass; commit** `feat(cli): AgentHost /v1/sessions 与鉴权门闸`

---

### Task 4: `POST …/messages` SSE + cancel + session resume/409

**Files:**
- Modify: `packages/cli/src/agent-host/http.ts`
- Modify: `packages/cli/test/agent-host.test.ts`

**Behaviour (spec):**
- `POST /v1/sessions/:id/messages` with `Accept: text/event-stream`, body `{ text }`
- If `id !== host.sessionId`, `await host.resume(id)` first; if turn busy → 409 before resume/send
- Track busy via `user`/`turn.end`/`turn.error`（可本地抄 hub 的 busy 标志，不要 import hub 的 cookie 逻辑）
- Subscribe to `host.on`, `writeHostEvent` until `turn.end` | `turn.error`, then `res.end()`
- `POST /v1/sessions/:id/cancel` → `host.cancel()` → 204
- P0: mid-turn second `messages` → 409 `turn_in_progress`

- [ ] **Step 1: Failing integration test with `--mock`**

```ts
test("messages streams HostEvents then ends; cancel works; busy is 409", async () => {
  // create session, POST messages with text that mock handles
  // read SSE until turn.end
  // assert some data lines parse as HostEvent with types user|text|turn.end
  // start messages, immediately second messages → 409
});
```

Mock LLM 路径与现有 cli 测试一致（`flags.mock: true`）。读 SSE：`res.body` 异步迭代或累积到 `turn.end`。

- [ ] **Step 2: Implement ensureSession + messages + cancel**

```ts
async function ensureSession(host: ChatHost, id: string, busy: boolean): Promise<void> {
  if (busy) throw new HttpError(409, "turn_in_progress");
  if (host.sessionId === id) return;
  await host.resume(id);
}
```

- [ ] **Step 3: Pass; commit** `feat(cli): AgentHost messages SSE 与 cancel`

---

### Task 5: CLI 入口 `tah agent-host`

**Files:**
- Modify: `packages/cli/src/args.ts`（`listenHost?: string`；usage 行）
- Modify: `packages/cli/src/cli.ts`（分支；允许无 LLM key 时与 serve 类似仅 mock，或要求 key/`--mock`）
- Modify: `packages/cli/src/index.ts`（如需导出类型）
- Test: args 解析小测或 agent-host 启动测

**Flags:**
- `tah agent-host` uses `--cwd`、`--port`（default 7800）、`--host`（default `0.0.0.0`）、`--mock`、`--persist` / `--no-persist`、既有 allow/deny 等
- Require `AR_SHARED_SECRET`；require `TAH_PROJECT_ID` or `--project-id <id>`
- Print `AgentHost listening on http://<host>:<port>`（不要 cookie URL）
- `cli.ts`：`command === "agent-host"` 时不要走「必须有 key」的早期拒绝（与 serve 一样允许以后再配；或强制 `--mock`/key——**选：与 serve 相同，无 key 可启动，发消息再失败**）

- [ ] **Step 1: Parse + usage 字符串**
- [ ] **Step 2: Wire `startAgentHost`；Ctrl+C → stop**
- [ ] **Step 3: Manual smoke：`AR_SHARED_SECRET=x TAH_PROJECT_ID=p pnpm tah -- agent-host --mock --host 127.0.0.1 --port 0`**
- [ ] **Step 4: Commit** `feat(cli): tah agent-host 命令入口`

---

### Task 6: 文档与 CHANGELOG（功能落地时）

**Files:**
- Create: `docs/design/agent-host.md`（从 spec 缩成用户向说明：非目标、鉴权、路由表、与 serve 对比）
- Modify: `docs/guide/status.md`、`docs/guide/cli.md`、`docs/guide/roadmap.md`（Phase AgentHost ✅）
- Modify: `CHANGELOG.md`（在 1.0.0 下补实现说明，或 `1.0.1` 若 1.0.0 仅开分支——**若本计划在 1.0.0 分支直接实现，把 1.0.0 条目从「Planned」改成已实现要点**）
- Modify: `docs/superpowers/specs/2026-10-18-agent-host-design.md` 状态 → ✅

- [ ] **Step 1: 写 design/agent-host.md**
- [ ] **Step 2: 更新 status/cli/roadmap/CHANGELOG**
- [ ] **Step 3: `pnpm test` 全绿（含原有 serve 测试）**
- [ ] **Step 4: Commit** `docs(agent-host): 说明无头宿主与 serve 的边界`

---

## Spec coverage (self-review)

| Spec 要求 | Task |
| --- | --- |
| Bearer + project_id | 1, 3 |
| `/health`, `/v1/sessions*`, messages SSE, cancel | 2–4 |
| HostEvent 原样 | 2, 4 |
| 单 ChatHost + resume + 409 | 4 |
| 不移植 serve cookie/UI | 全程不碰 serve 行为 |
| CLI 入口 | 5 |
| 文档 | 6 |
| P1 answer/question | 不在本计划 |

## 不做（本计划）

- 审批 / ask_user HTTP、附件、排队、浏览器、Settings、多 ChatHost 每 session
