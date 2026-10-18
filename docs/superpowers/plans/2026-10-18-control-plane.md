# 控制面 P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `apps/control`, an intranet control plane that logs users in, stores projects and members, starts one `tah agent-host` container per project, and proxies `/v1` with a short-lived HMAC Bearer.

**Architecture:** A private Node app (`node:http` + `node:sqlite`) owns sessions and project metadata. A `Runtime` interface is implemented by an in-memory fake in tests and by Docker (`inspect` IP, no published ports) in production. The proxy signs tokens with `signAgentHostToken` from the CLI package. `tah serve` is not modified.

**Tech Stack:** TypeScript (NodeNext), Node 22 `node:sqlite` / `node:http` / `node:crypto` (scrypt), workspace dependency on `@typescript-agent-harness/cli`.

**Spec:** `docs/superpowers/specs/2026-10-18-control-plane-design.md`

## Global Constraints

- Branch `v1.1`. Do not change `tah serve`, TUI, or AgentHost HTTP behaviour except exporting `signAgentHostToken` from the CLI package entry if it is not already exported.
- New code lives in `apps/control/**` plus that one CLI export, docs, and root `package.json` script if needed.
- No real Docker in CI. Tests inject a fake runtime and a fake AgentHost HTTP server.
- Passwords stored as scrypt hashes. Session cookie: `HttpOnly; SameSite=Lax; Path=/`.
- Audit rows: user id, project id, route, status, time. Never store message bodies.
- Idle stop is 30 minutes. Wake timeout is 60 seconds → 503.
- Bearer `exp` is now + 600 seconds. Secret is `AR_SHARED_SECRET`.
- Commits via `~/.cursor/skills/code-commit/SKILL.md`. Never push. Never commit `.superpowers/`.

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `apps/control/package.json` | 私有包，`test` 用 `node --test` |
| `apps/control/src/store.ts` | 用户、项目、成员、审计 |
| `apps/control/src/auth.ts` | scrypt、会话 |
| `apps/control/src/runtime.ts` | `ProjectRuntime` 接口 + Docker 实现 |
| `apps/control/src/proxy.ts` | 签 Bearer 并转发（含 SSE） |
| `apps/control/src/http.ts` | 路由 |
| `apps/control/src/main.ts` | 读环境变量并 listen |
| `apps/control/test/*.test.ts` | store、http、proxy |
| `packages/cli/src/index.ts` | 导出 `signAgentHostToken` |
| `docs/design/control-plane.md` | 用户向说明（最后一任务） |

---

### Task 1: store 与登录、项目成员

**Files:**
- Create: `apps/control/package.json`, `tsconfig.json`, `src/store.ts`, `src/auth.ts`, `src/http.ts`, `src/main.ts`
- Test: `apps/control/test/store.test.ts`, `apps/control/test/http.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Role = "owner" | "member";
  export type Store = {
    createUser(username: string, passwordHash: string): { id: string };
    userByName(username: string): { id: string; username: string; passwordHash: string } | undefined;
    createProject(ownerId: string, name: string): { id: string; name: string };
    projectsFor(userId: string): { id: string; name: string; role: Role }[];
    addMember(projectId: string, userId: string, role: Role): void;
    role(projectId: string, userId: string): Role | undefined;
    audit(row: { userId: string; projectId: string; route: string; status: number }): void;
  };
  export function openStore(file: string): Store;
  export function hashPassword(password: string): string;
  export function verifyPassword(password: string, hash: string): boolean;
  ```

- [ ] **Step 1: Scaffold the package**

`package.json` name `@typescript-agent-harness/control`, `"private": true`, `"type": "module"`, scripts `build` / `typecheck` / `test` like `apps/desktop` tests (`node --test --experimental-strip-types test/*.test.ts`). `tsconfig` extends the repo style (`NodeNext`, strict). No dependency on CLI yet.

- [ ] **Step 2: Failing store test**

Create a user, create a project, list shows `owner`, second user is not listed until `addMember`, `role` is undefined for strangers.

- [ ] **Step 3: Implement `openStore` with `node:sqlite`**

Tables: `users`, `projects`, `members`, `audit`. Ids are `crypto.randomUUID()`.

- [ ] **Step 4: Failing HTTP test for login and projects**

`POST /api/login` wrong password → 401. Right password → `Set-Cookie` contains `HttpOnly`. `GET /api/projects` without cookie → 401. With cookie, only member projects. `POST /api/projects/:id/members` by a non-owner → 403.

Seed one user via `hashPassword` + `createUser` before listen. Use `127.0.0.1` and port 0.

- [ ] **Step 5: Implement auth + http routes for login, logout, me, projects, members**

No docker, no proxy yet. Unknown `/api/projects/:id/agent/*` can 404 until Task 3.

- [ ] **Step 6: Tests pass; commit** `feat(control): 登录与项目成员`

---

### Task 2: 假 runtime 的 wake / stop

**Files:**
- Create: `apps/control/src/runtime.ts`
- Modify: `apps/control/src/http.ts`
- Test: `apps/control/test/http.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ProjectRuntime = {
    ensure(projectId: string): Promise<{ baseUrl: string }>;
    stop(projectId: string): Promise<void>;
    touch(projectId: string): void;
  };
  export function createFakeRuntime(): ProjectRuntime & { calls: string[] };
  ```

- [ ] **Step 1: Failing test**

`POST /api/projects/:id/wake` as a member → 200 `{ status: "ready" }` and fake `ensure` recorded. Non-member → 403 and fake not called. Calling `touch` then advancing a clock past 30 minutes invokes `stop` (pass `now` / `idleMs` into the idle checker so the test does not sleep).

- [ ] **Step 2: Implement**

`wake` calls `runtime.ensure`. Idle checker is a function `sweepIdle(runtime, lastTouch, now, idleMs)` used by a `setInterval` in `main.ts` (30 min) and directly in the test.

- [ ] **Step 3: Pass; commit** `feat(control): 项目容器 wake 与空闲停止`

---

### Task 3: Bearer 代理与 SSE

**Files:**
- Modify: `packages/cli/src/index.ts` — export `signAgentHostToken` and `AgentHostClaims` from `./agent-host/auth.js`
- Modify: `apps/control/package.json` — depend on `@typescript-agent-harness/cli` workspace
- Create: `apps/control/src/proxy.ts`
- Modify: `apps/control/src/http.ts`
- Test: `apps/control/test/proxy.test.ts`

**Interfaces:**
- `proxyAgent(req, res, opts: { baseUrl, secret, projectId, userId, suffix })` forwards method, body, and streams the response (SSE included). Sets `Authorization: Bearer`.

- [ ] **Step 1: Failing test**

Start a tiny `node:http` fake AgentHost. Member `GET /api/projects/:id/agent/health` returns the fake body. The fake asserts `verifyAgentHostToken` with that `projectId` succeeds and `exp` is within 15 minutes. Non-member gets 403 and the fake sees no request. `POST .../agent/v1/sessions/x/messages` streams two SSE `data:` lines through unchanged.

- [ ] **Step 2: Implement proxy**

Use `fetch` to `baseUrl + suffix` with `duplex: "half"` when a body exists. Pipe `res.body` to the client response. On each proxied call, `runtime.touch(projectId)`. Wake first so `baseUrl` exists.

- [ ] **Step 3: Audit**

After the proxied response ends, `store.audit({ userId, projectId, route, status })`. Test reads the audit table and asserts the route is stored and the request body is not.

- [ ] **Step 4: Pass; commit** `feat(control): 代理 AgentHost 并附短时 Bearer`

---

### Task 4: Docker runtime（不进 CI）

**Files:**
- Modify: `apps/control/src/runtime.ts` — `createDockerRuntime`
- Modify: `apps/control/src/main.ts` — wire env
- Create: `apps/control/Dockerfile` — image that runs `tah agent-host` (document build; do not run in tests)

**Behaviour:**
- Container name `tah-project-<id>`
- No `-p` publish. `docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}'` then `http://<ip>:7800`
- `docker start` if the container exists and is stopped; `docker run -d` otherwise
- Volume `<data>/projects/<id>/workspace` → `/workspace`
- Command and env exactly as the spec (`--yes`, secret, project id, model keys if present)
- `ensure` polls `/health` until ok or 60s then throws (HTTP layer maps to 503)
- `stop` is `docker stop`, not `docker rm`

- [ ] **Step 1: Unit-test the argument builder**

Export `dockerRunArgs(opts)` and assert name, no `-p`, volume, command, env. Do not spawn docker.

- [ ] **Step 2: Implement `createDockerRuntime` using `spawn`**

- [ ] **Step 3: `main.ts` reads `CONTROL_DATA`, `CONTROL_IMAGE`, `AR_SHARED_SECRET`, listen `CONTROL_HOST` default `127.0.0.1`, `CONTROL_PORT` default `7810`**

Missing `AR_SHARED_SECRET` exits 1.

- [ ] **Step 4: Commit** `feat(control): Docker 运行时与启动入口`

---

### Task 5: 文档

**Files:**
- Create: `docs/design/control-plane.md`（从 spec 缩成用法：环境变量、登录、代理路径、与 serve / agent-host 的边界）
- Modify: `docs/guide/status.md`, `docs/guide/roadmap.md`（控制面 P0 ✅，标成未发版或随版本号）
- Modify: spec 状态行 → ✅
- Do **not** bump package versions or CHANGELOG until the user asks to release

- [ ] **Step 1: Write the design page and status/roadmap lines**
- [ ] **Step 2: `pnpm --filter @typescript-agent-harness/control test` green**
- [ ] **Step 3: Commit** `docs(control): 说明控制面与 agent-host 的边界`

## Spec coverage

| Spec | Task |
| --- | --- |
| 登录、项目、成员、审计 | 1, 3 |
| wake / 空闲 stop | 2, 4 |
| Bearer 代理与 SSE | 3 |
| 不发布端口、docker inspect | 4 |
| 不在 CI 起真 Docker | 2–4 |
| 不改 tah serve | 全程 |
