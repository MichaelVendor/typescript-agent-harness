# Parallel Sessions (Claude-style workers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `tah serve` run multiple Agent turns in parallel by spawning `tah agent-worker` child processes (usually in git worktrees), with a focus-aware web UI and per-worker browser profiles — matching Claude Code’s process + worktree model.

**Architecture:** Parent `tah serve` keeps today’s in-process `ChatHost` as `workerId: "main"`. Parallel sessions are child processes speaking Bearer-authenticated HostEvent SSE on `127.0.0.1`. `SessionOrchestrator` creates worktrees, spawns/reaps workers, enforces a busy cap of 4, and tags events with `workerId`. The web UI shows one focused transcript; background workers emit `attention` for approval/question.

**Tech Stack:** TypeScript (NodeNext), `node:http`, `node:child_process`, existing `ChatHost` / `HostEvent` / agent-host SSE patterns, React web UI, `node --test --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-10-28-parallel-sessions-design.md`

## Global Constraints

- Do not change `tah chat` / TUI or `tah agent-host` / control-plane behaviour in this plan.
- Do not promise same-cwd parallel file safety; parallel creates use git worktrees under `<repo>/.tah/worktrees/<name>/`, branch `tah/<name>`.
- Default max **4** concurrent busy workers including `main`; excess → HTTP 409.
- Browser profiles: `~/.tah/browser-profiles/<id>/` (not the single global `browser-profile`).
- Commits via `~/.cursor/skills/code-commit/SKILL.md`; never push; never `--no-verify`; never commit `.superpowers/`.
- After each task: `pnpm --filter @typescript-agent-harness/cli build` (and web build when touching `packages/web`) before claiming done.

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `packages/cli/src/agent-worker/auth.ts` | Compare `TAH_WORKER_TOKEN` Bearer (timing-safe) |
| `packages/cli/src/agent-worker/http.ts` | Worker routes: events SSE, send/cancel/answer/… |
| `packages/cli/src/agent-worker/run.ts` | Listen `127.0.0.1:0`, print ready line, ChatHost lifecycle |
| `packages/cli/src/serve/worktree.ts` | `git worktree add/remove` helpers |
| `packages/cli/src/serve/orchestrator.ts` | Spawn/focus/cap/list/reap workers; client to worker HTTP |
| `packages/cli/src/serve/hub.ts` | Extend or wrap: per-worker hubs + focus + attention |
| `packages/cli/src/serve/protocol.ts` | `ServeEvent`, worker APIs, `attention` |
| `packages/cli/src/serve/http.ts` | `/api/workers/*`, stamp `workerId` on writes |
| `packages/cli/src/browser.ts` | Profile dir keyed by id |
| `packages/cli/src/args.ts` / `cli.ts` | `tah agent-worker` command |
| `packages/web/src/…` | Side rail busy/attention; send with `workerId` |
| `packages/cli/test/agent-worker*.ts`, `orchestrator*.ts`, `worktree*.ts` | Tests |
| `docs/design/serve.md` / CHANGELOG / status | Ship notes when feature lands (last task) |

---

### Task 1: Worker Bearer check

**Files:**
- Create: `packages/cli/src/agent-worker/auth.ts`
- Test: `packages/cli/test/agent-worker-auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Returns true if Authorization Bearer matches token (timing-safe). */
  export function checkWorkerBearer(header: string | undefined, token: string): boolean;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWorkerBearer } from "../dist/agent-worker/auth.js";

test("checkWorkerBearer accepts matching Bearer and rejects others", () => {
  assert.equal(checkWorkerBearer("Bearer secret-token", "secret-token"), true);
  assert.equal(checkWorkerBearer("bearer secret-token", "secret-token"), true);
  assert.equal(checkWorkerBearer("Bearer wrong", "secret-token"), false);
  assert.equal(checkWorkerBearer(undefined, "secret-token"), false);
  assert.equal(checkWorkerBearer("Basic x", "secret-token"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/agent-worker-auth.test.ts`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement**

Parse `/^Bearer\s+(\S+)/i`; compare with `crypto.timingSafeEqual` on equal-length buffers (if lengths differ, return false).

- [ ] **Step 4: Run test to verify it passes** — same command; PASS

- [ ] **Step 5: Commit** — `feat(cli): agent-worker Bearer 校验`

---

### Task 2: Worker HTTP + run (queue-capable ChatHost surface)

**Files:**
- Create: `packages/cli/src/agent-worker/http.ts`
- Create: `packages/cli/src/agent-worker/run.ts`
- Reuse: `packages/cli/src/agent-host/sse.ts` `writeHostEvent` (import; do not fork copy)
- Test: `packages/cli/test/agent-worker.test.ts`
- Modify: `packages/cli/src/args.ts`, `packages/cli/src/cli.ts` — command `agent-worker`

**Interfaces:**
- Produces:
  ```ts
  export type AgentWorkerOptions = {
    token: string;
    flags: CliFlags; // cwd from flags.cwd
    homeDir?: string;
  };
  export function startAgentWorker(opts: AgentWorkerOptions): Promise<{
    url: string; // http://127.0.0.1:<port>
    host: ChatHost;
    stop(): Promise<void>;
  }>;
  ```
- Ready line on stdout (parent parses): `[tah-worker] ready http://127.0.0.1:PORT\n`
- Routes (all except health need Bearer):
  - `GET /health` → `{ ok: true }`
  - `GET /events` → SSE all `HostEvent` from `host.on` (subscribe before any write)
  - `POST /send` `{ text, attachmentIds? }` → `host.send` (queues when busy, like serve)
  - `POST /cancel` → `host.cancel`
  - `POST /answer` / `POST /question` — same bodies as serve
  - `POST /continue` / `POST /compact` / `POST /queue` — same as serve
- Bind **only** `127.0.0.1`; port from `--port` (0 = ephemeral).
- Env: `TAH_WORKER_TOKEN` required to start (or `--token` for tests).

- [ ] **Step 1: Failing integration test** — start worker with mock flags / fake token, `GET /health` 200, `GET /events` without token 401, with token gets SSE after `POST /send` (use existing mock LLM patterns from `packages/cli/test/agent-host.test.ts` / serve tests).

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement http + run + CLI wiring**  
  `historyTurns: Infinity` like serve. On listen, print ready line. `stop` closes server + `host.close()`.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** — `feat(cli): tah agent-worker 本机 HostEvent HTTP`

---

### Task 3: Worktree helpers

**Files:**
- Create: `packages/cli/src/serve/worktree.ts`
- Test: `packages/cli/test/worktree.test.ts` (temp git repo via `git init`)

**Interfaces:**
- Produces:
  ```ts
  export function isGitRepo(cwd: string): boolean;
  /** Creates `<repo>/.tah/worktrees/<name>` on branch `tah/<name>`. Throws if not a git repo or name invalid. */
  export function addWorktree(repoRoot: string, name: string): { path: string; branch: string };
  /** Best-effort remove; ignores errors when `force` path was never added. */
  export function removeWorktree(repoRoot: string, name: string): void;
  export function worktreePath(repoRoot: string, name: string): string;
  ```
- Name: `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/` or throw.
- Commands: `git worktree add -b tah/<name> <path>`; remove: `git worktree remove --force <path>` then `git branch -D tah/<name>` best-effort.

- [ ] **Step 1: Failing tests** — non-git throws; add creates dir + branch; remove cleans.

- [ ] **Step 2–4: TDD implement + PASS**

- [ ] **Step 5: Commit** — `feat(cli): git worktree 创建与清理`

---

### Task 4: SessionOrchestrator (spawn, focus, cap, client)

**Files:**
- Create: `packages/cli/src/serve/orchestrator.ts`
- Test: `packages/cli/test/orchestrator.test.ts` (spawn real `agent-worker` with `--mock` if available, or inject `spawnWorker` dependency)

**Interfaces:**
- Produces:
  ```ts
  export type WorkerInfo = {
    id: string; // "main" or generated
    cwd: string;
    sessionId: string;
    busy: boolean;
    needsAttention: boolean;
    worktree?: { name: string; parent: string };
    dead?: boolean;
  };

  export type Orchestrator = {
    readonly focusId: string;
    list(): WorkerInfo[];
    busyCount(): number;
    focus(id: string): void;
    /** Create worktree (unless cwd given) and spawn worker. Throws/rejects with message for 409/400. */
    parallel(opts: { name?: string; cwd?: string }): Promise<WorkerInfo>;
    stop(id: string): Promise<void>;
    restart(id: string): Promise<void>;
    remove(id: string): Promise<void>; // stop + optional worktree remove if we created it
    /** Proxy write to worker or main host */
    send(id: string, text: string, attachmentIds?: string[]): Promise<void>;
    // … answer, cancel, continue, compact, queue same pattern
    onEvent(listener: (workerId: string, event: HostEvent) => void): () => void;
    dispose(): Promise<void>; // SIGTERM all children
  };

  export function createOrchestrator(opts: {
    main: ChatHost;
    mainCwd: string;
    flags: CliFlags;
    homeDir: string;
    maxBusy?: number; // default 4
    /** test seam */
    spawnWorker?: (args: { cwd: string; token: string }) => Promise<{ url: string; kill(): void }>;
  }): Orchestrator;
  ```
- Cap: before starting a turn on idle→busy path or creating parallel while already at cap of busy workers, reject with Error message usable as 409 body `too many busy workers (max 4)`.
- Spawn: `process.execPath` + cli path + `agent-worker --cwd … --port 0`, env `TAH_WORKER_TOKEN`, parse ready line from stdout (timeout 15s).
- Subscribe each worker `/events` with fetch/EventSource-like read; forward via `onEvent`.
- `main` never spawned; id always `"main"`.

- [ ] **Step 1: Unit tests with fake `spawnWorker`** — two workers both receive events; focus switches; 5th busy throws; dispose kills.

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** — `feat(cli): SessionOrchestrator 多 worker 编排`

---

### Task 5: Focus hub + ServeEvent + attention + parent HTTP

**Files:**
- Modify: `packages/cli/src/serve/protocol.ts` — add types
- Modify / extend: `packages/cli/src/serve/hub.ts` OR new `packages/cli/src/serve/multi-hub.ts` if hub stays single-host for main-only path
- Modify: `packages/cli/src/serve/http.ts` — wire orchestrator routes; tag events
- Modify: serve bootstrap (`packages/cli/src/serve/run.ts` or equivalent) to construct orchestrator
- Test: `packages/cli/test/serve-workers.test.ts`

**Interfaces:**
- Produces (protocol):
  ```ts
  export type ServeEvent =
    | (HostEvent & { workerId: string; cwd: string; sessionId: string })
    | { type: "attention"; workerId: string; kind: "approval" | "question"; summary: string }
    | { type: "workers"; workers: WorkerInfo[]; focusId: string };

  // ServeRequest additions:
  // workersParallel: { name?: string; cwd?: string }
  // workersFocus: { id: string }
  // workersStop | workersRestart | workersRemove: { id: string }
  // send / answer / … optional workerId?: string
  ```
- SSE to browser: only full HostEvents for **focus** worker (plus startup replay for that worker). For others: update internal summary; on approval/question emit `attention` + periodic/on-change `workers` list events.
- Switching focus: emit `workers` then replay that worker’s hub snapshot (may open short-lived subscribe if needed).
- `POST /api/workers/parallel|focus|stop|restart|remove`, `GET /api/workers`.
- Writes: resolve `workerId ?? focusId`; do **not** call global `hub.assertIdle()` across workers — only assert idle on the **target** worker when the operation requires idle (reset/resume/fork/workspace switch as today for main).
- Workspace `activate` while any worker busy: keep current behaviour for main-only ops; document that switching folder still requires main idle (v1); parallel workers for other cwds may keep running.

- [ ] **Step 1: Tests** — parallel two sends both complete; attention when background approval; answer without focus → 409; focus then answer ok; 5th busy 409.

- [ ] **Step 2–4: Implement + PASS** (existing serve tests must stay green)

- [ ] **Step 5: Commit** — `feat(cli): serve 多 worker HTTP 与 attention 事件`

---

### Task 6: Worktree → workspaces metadata

**Files:**
- Modify: `packages/cli/src/workspaces.ts` and/or `packages/cli/src/serve/workspaces.ts` to allow optional metadata `{ kind?: "worktree"; parent?: string }` persisted (extend `workspaces.json` or sibling file — prefer extending JSON entries to objects `{ path, kind?, parent? }` with backward compat for bare string paths).
- Wire `orchestrator.parallel` without `cwd` to `addWorktree` then `addWorkspace` with metadata.
- Test: workspaces load old string format + new object format.

- [ ] **Step 1–4: TDD**

- [ ] **Step 5: Commit** — `feat(cli): worktree 并行写入 workspaces 元数据`

---

### Task 7: Browser profile isolation + panel follows focus

**Files:**
- Modify: `packages/cli/src/browser.ts` — `profileDir(homeDir, id: string)` → `path.join(homeDir, ".tah", "browser-profiles", id)`
- Pass id from runtime/orchestrator (`main` or worker id / hash of cwd). Worker child must receive profile id via env e.g. `TAH_BROWSER_PROFILE_ID`.
- Modify: serve screen wiring so CDP attaches to **focused** worker’s browser only; on focus change call `screen.sync()` / reconnect.
- Test: `packages/cli/test/browser-profile.test.ts` asserts path contains `browser-profiles` and differs by id.

- [ ] **Step 1–4: TDD + implement**

- [ ] **Step 5: Commit** — `feat(cli): 按 worker 隔离浏览器 profile`

---

### Task 8: Web UI — workers rail, attention, workerId on writes

**Files:**
- Modify: `packages/web/src/api.ts` — workers endpoints; send body includes `workerId`
- Modify: session rail / App components that list sessions — show worker busy badge, attention chip
- Modify: event reducer — ignore full transcript events for non-focus (or only apply when `workerId === focusId`); handle `attention` + `workers`
- Modify: approval/question UI — disable answer unless focused worker matches
- Test: extend web unit tests for reducer if present; otherwise cli serve-workers covers protocol

- [ ] **Step 1: Failing web/reducer tests for attention + focus filter**

- [ ] **Step 2–4: Implement UI + `pnpm --filter @typescript-agent-harness/web build` PASS

- [ ] **Step 5: Commit** — `feat(web): 并行 worker 侧栏与 attention`

---

### Task 9: Docs + status flip

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-parallel-sessions-design.md` status → ✅ 已实现（when shipping）
- Modify: `docs/design/serve.md` / `workspaces.md` — replace “未实现” with short behaviour summary + link
- Modify: `CHANGELOG.md`, `docs/guide/status.md` when cutting the release version (coordinate with release; if feature merges before release bump, changelog under Unreleased or next patch)
- Note in design: suggest `.gitignore` entry `.tah/worktrees/`

- [ ] **Step 1: Update docs to match shipped behaviour**

- [ ] **Step 2: Commit** — `docs: 并行 session 已实现说明`

---

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| `tah agent-worker` HTTP + Bearer | 1–2 |
| Worktree path/branch + non-git error | 3, 6 |
| Orchestrator spawn/focus/cap/dispose | 4 |
| Event tagging, attention, parent APIs | 5 |
| workspaces metadata | 6 |
| Browser profile isolation + panel focus | 7 |
| Web UI | 8 |
| Docs | 9 |
| No TUI / agent-host changes | Global constraints |
| Max 4 busy | 4–5 |

## Out of this plan

- TUI parallel, agent-host multi-process, agent teams, messaging, batch, `.worktreeinclude`, split-pane transcripts.
