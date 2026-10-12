# Serve Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tah serve` manages several project folders: the sidebar groups sessions by folder, folders are added through an in-page directory browser, and opening a session in another folder makes that folder the agent's working directory.

**Architecture:** One active `ChatHost` at a time. A new workspace manager (`serve/workspaces.ts`) owns it; switching builds and opens a host for the target folder first, then `hub.swap()`s to it and closes the old one. Non-active folders' session lists are read straight from their `.tah/cli.db`. The folder list lives in `~/.tah/workspaces.json`.

**Tech Stack:** TypeScript (Node ≥22), `node:http`, `node:test`, React (packages/web).

**Spec:** `docs/design/workspaces.md`

## Global Constraints

- Only one current session at a time; switching folders while a turn runs → 409 (`BusyError`).
- Folder list: `~/.tah/workspaces.json` = `{ "workspaces": string[] }` (absolute, `path.resolve`d, insertion order). Corrupt / unreadable → empty list.
- `tah serve` adds its own `cwd` on start. Removing the active folder → 409. Removing never touches disk.
- `GET /api/fs` lists sub-folder names only; skips names starting with `.`.
- Switching failure leaves the old folder active and untouched.
- New hosts use the serve flags with `cwd` replaced and `session: ""` (a `--session` ref belongs to the startup folder only).
- `tah chat` / TUI / `tah sessions` behaviour unchanged.
- Tests import from `../dist/*.js`; build with `pnpm --filter @typescript-agent-harness/cli build` before `pnpm --filter @typescript-agent-harness/cli test`. Tests that write `~/.tah` must inject a temp home.
- Commits: Conventional Commits via code-commit skill; Chinese description OK. Never push.

## File map

| File | Responsibility |
| --- | --- |
| `packages/cli/src/workspaces.ts` (new) | Read / add / remove the folder list in `<home>/.tah/workspaces.json` |
| `packages/cli/src/runtime.ts` | `readSavedSessions(cwd)` → `SessionRow[]` (no LLM); `listSavedSessions` uses it |
| `packages/cli/src/serve/hub.ts` | `swap(host, buffered)` |
| `packages/cli/src/serve/fs.ts` (new) | `listDirs`, `makeDir` for the directory browser |
| `packages/cli/src/serve/workspaces.ts` (new) | Workspace manager: active host, `activate`, `list`, per-folder rename / flag |
| `packages/cli/src/serve/protocol.ts` | New request bodies, `WorkspaceView`, `DirListing` |
| `packages/cli/src/serve/http.ts` | New endpoints; optional `cwd` on reset / resume / fork / rename / session-flag |
| `packages/cli/src/serve/run.ts` | Wire the manager; `startServe(flags, { homeDir })` |
| `packages/cli/src/index.ts` | Export `WorkspaceView`, `DirListing` types |
| `packages/web/src/api.ts`, `App.tsx`, `components/Sidebar.tsx`, `components/FolderPicker.tsx` (new), `components/StatusBar.tsx`, `styles.css` | UI |
| `docs/design/workspaces.md`, `docs/design/serve.md`, `docs/guide/cli.md`, `CHANGELOG.md` | Docs |

---

### Task 1: Folder list (`workspaces.ts`) and `readSavedSessions`

**Files:**
- Create: `packages/cli/src/workspaces.ts`
- Modify: `packages/cli/src/runtime.ts` (around `listSavedSessions`, ~line 303)
- Test: `packages/cli/test/workspaces.test.ts` (new)

**Interfaces:**
- Produces:
  - `workspacesPath(home: string): string`
  - `loadWorkspaces(home: string): string[]`
  - `addWorkspace(home: string, dir: string): string[]` (returns the new list; no-op if present)
  - `removeWorkspace(home: string, dir: string): string[]`
  - `readSavedSessions(cwd: string): Promise<SessionRow[]>` (from `runtime.ts`; `[]` when no db)

- [ ] **Step 1: Write the failing tests** — `packages/cli/test/workspaces.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readSavedSessions } from "../dist/runtime.js";
import { addWorkspace, loadWorkspaces, removeWorkspace, workspacesPath } from "../dist/workspaces.js";

test("workspaces.json: add dedupes by resolved path, remove keeps order", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ws-home-"));
  assert.deepEqual(loadWorkspaces(home), []);
  addWorkspace(home, "/tmp/a");
  addWorkspace(home, "/tmp/b/");
  addWorkspace(home, "/tmp/x/../a");
  assert.deepEqual(loadWorkspaces(home), ["/tmp/a", "/tmp/b"]);
  assert.match(readFileSync(workspacesPath(home), "utf8"), /"workspaces"/);
  assert.deepEqual(removeWorkspace(home, "/tmp/a"), ["/tmp/b"]);
  assert.deepEqual(loadWorkspaces(home), ["/tmp/b"]);
});

test("workspaces.json: corrupt or wrong-shaped file reads as empty", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ws-home-"));
  mkdirSync(path.join(home, ".tah"));
  writeFileSync(workspacesPath(home), "{");
  assert.deepEqual(loadWorkspaces(home), []);
  writeFileSync(workspacesPath(home), JSON.stringify({ workspaces: ["/ok", 3, null] }));
  assert.deepEqual(loadWorkspaces(home), ["/ok"]);
});

test("readSavedSessions: [] without a db", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ws-empty-"));
  assert.deepEqual(await readSavedSessions(cwd), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/workspaces.test.ts`
Expected: FAIL — cannot find module `../dist/workspaces.js`.

- [ ] **Step 3: Implement** — `packages/cli/src/workspaces.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Folders shown in the `tah serve` sidebar, under `<home>/.tah/workspaces.json`. */
export function workspacesPath(home: string): string {
  return path.join(home, ".tah", "workspaces.json");
}

export function loadWorkspaces(home: string): string[] {
  const file = workspacesPath(home);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { workspaces?: unknown };
    if (!Array.isArray(raw?.workspaces)) return [];
    const dirs = raw.workspaces.filter((d): d is string => typeof d === "string").map((d) => path.resolve(d));
    return [...new Set(dirs)];
  } catch {
    // unreadable file: treat as no folders
    return [];
  }
}

function save(home: string, dirs: string[]): string[] {
  const file = workspacesPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ workspaces: dirs }, null, 2)}\n`);
  return dirs;
}

export function addWorkspace(home: string, dir: string): string[] {
  const dirs = loadWorkspaces(home);
  const target = path.resolve(dir);
  return dirs.includes(target) ? dirs : save(home, [...dirs, target]);
}

export function removeWorkspace(home: string, dir: string): string[] {
  const target = path.resolve(dir);
  return save(home, loadWorkspaces(home).filter((d) => d !== target));
}
```

In `packages/cli/src/runtime.ts`, replace `listSavedSessions` with:

```ts
/** Rows of `<cwd>/.tah/cli.db` without an LLM or API key; `[]` when there is no db. */
export async function readSavedSessions(cwd: string): Promise<SessionRow[]> {
  const dbPath = path.join(cwd, ".tah/cli.db");
  if (!existsSync(dbPath)) return [];
  const { storagePlugin } = await import("@typescript-agent-harness/storage");
  const runtime = new Runtime({ id: "tah-sessions" });
  runtime.use(storagePlugin({ driver: "sqlite", path: dbPath }));
  await runtime.start();
  try {
    return toRows(await (await storageOf(runtime)).listSessions(), cwd);
  } finally {
    await runtime.stop();
  }
}

/** For `tah sessions`: reads `<cwd>/.tah/cli.db` without an LLM or API key. */
export async function listSavedSessions(cwd: string): Promise<string> {
  const dbPath = path.join(cwd, ".tah/cli.db");
  if (!existsSync(dbPath)) return `[tah] no saved sessions (${dbPath} does not exist)`;
  return formatSessions(await readSavedSessions(cwd));
}
```

Add `type SessionRow` to the existing `./sessions.js` import in `runtime.ts` (`import { formatSessions, resolveSessionRef, toRows, type SessionRow } from "./sessions.js";`). `describeSessions` stays (used by `/sessions`).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @typescript-agent-harness/cli build && pnpm --filter @typescript-agent-harness/cli test`
Expected: all pass (existing `sessions.test.ts` covers `tah sessions` output unchanged).

- [ ] **Step 5: Commit** — `feat(cli): 工作文件夹列表与只读会话行`

---

### Task 2: `hub.swap`

**Files:**
- Modify: `packages/cli/src/serve/hub.ts`
- Test: `packages/cli/test/hub.test.ts` (new)

**Interfaces:**
- Consumes: `ChatHost`, `HostEvent`, `SessionEvent` from `../dist/host.js`
- Produces: `Hub.swap(host: ChatHost, buffered: HostEvent[]): void` — throws `BusyError` while a turn runs; drops the old host's replay state; records + broadcasts `buffered`; then streams the new host.

- [ ] **Step 1: Write the failing test** — `packages/cli/test/hub.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatHost, HostEvent, SessionEvent } from "../dist/host.js";
import { createHub } from "../dist/serve/hub.js";

function stubHost(id: string) {
  const listeners = new Set<(e: HostEvent) => void>();
  const snap: SessionEvent = { type: "session", id, resumed: false, history: [], hiddenTurns: 0 };
  const host = {
    on(l: (e: HostEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot: () => snap,
  } as unknown as ChatHost;
  return { host, snap, emit: (e: HostEvent) => listeners.forEach((l) => l(e)), count: () => listeners.size };
}

test("swap replays only the new host and stops listening to the old one", () => {
  const a = stubHost("a");
  const b = stubHost("b");
  const hub = createHub(a.host);
  a.emit({ type: "notice", text: "boot a" });
  a.emit(a.snap);

  const live: HostEvent[] = [];
  hub.subscribe((e) => live.push(e));
  live.length = 0;

  hub.swap(b.host, [{ type: "notice", text: "boot b" }, b.snap]);
  assert.deepEqual(live, [{ type: "notice", text: "boot b" }, b.snap]);
  assert.equal(a.count(), 0);

  a.emit({ type: "text", delta: "stale" });
  b.emit({ type: "text", delta: "fresh" });
  assert.deepEqual(live.at(-1), { type: "text", delta: "fresh" });

  const late: HostEvent[] = [];
  hub.subscribe((e) => late.push(e));
  assert.deepEqual(late, [{ type: "notice", text: "boot b" }, b.snap, { type: "text", delta: "fresh" }]);
});

test("swap is refused while a turn runs", () => {
  const a = stubHost("a");
  const hub = createHub(a.host);
  a.emit(a.snap);
  hub.start(() => new Promise(() => {}));
  assert.throws(() => hub.swap(stubHost("b").host, []), /a turn is running/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/hub.test.ts`
Expected: FAIL — `hub.swap is not a function`.

- [ ] **Step 3: Implement** — in `packages/cli/src/serve/hub.ts`:

Add to the `Hub` type:

```ts
  /** Moves every tab to `host`; `buffered` are the events it emitted while opening. Throws `BusyError` while a turn runs. */
  swap(host: ChatHost, buffered: HostEvent[]): void;
```

Change `createHub(host: ChatHost)` to keep the host in a variable and the subscription in another:

```ts
export function createHub(first: ChatHost): Hub {
  let host = first;
  // ...existing state (listeners, startup, base, lastEnd, turn, busy) and `record` unchanged — `record` reads `host.snapshot()`...

  const forward = (event: HostEvent) => {
    record(event);
    for (const listener of listeners) listener(event);
  };
  let unsubscribe = host.on(forward);
```

(replacing the old `host.on((event) => { record(event); for (...) listener(event); });`), and add to the returned object:

```ts
    swap(next, buffered) {
      assertIdle();
      unsubscribe();
      startup.length = 0;
      base = undefined;
      lastEnd = undefined;
      turn = [];
      host = next;
      for (const event of buffered) forward(event);
      unsubscribe = host.on(forward);
    },
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @typescript-agent-harness/cli build && pnpm --filter @typescript-agent-harness/cli test`
Expected: all pass.

- [ ] **Step 5: Commit** — `feat(cli): serve hub 支持切换到另一个 host`

---

### Task 3: Directory browser helpers and workspace manager

**Files:**
- Create: `packages/cli/src/serve/fs.ts`, `packages/cli/src/serve/workspaces.ts`
- Modify: `packages/cli/src/serve/protocol.ts`, `packages/cli/src/index.ts`
- Test: `packages/cli/test/serve-workspaces.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 (`loadWorkspaces`, `addWorkspace`, `removeWorkspace`, `readSavedSessions` signature), Task 2 (`Hub.swap`), `setSessionTitle(cwd, id, title)` from `../session-titles.js`, `setSessionFlag(cwd, id, flag, on)` / `SessionFlag` from `../session-flags.js`.
- Produces (`serve/fs.ts`):
  - `listDirs(dir: string | undefined, home: string): DirListing`
  - `makeDir(parent: string, name: string): string` (returns the new absolute path)
- Produces (`serve/protocol.ts`):
  - `type WorkspaceView = { path: string; name: string; active: boolean; missing?: true; error?: string; sessions: SessionRow[] }`
  - `type DirListing = { path: string; parent: string | null; dirs: string[] }`
- Produces (`serve/workspaces.ts`):
  - `class ConflictError extends Error` (HTTP 409)
  - `type Workspaces = { readonly cwd: string; readonly host: ChatHost; list(): Promise<WorkspaceView[]>; add(dir: string): void; remove(dir: string): void; activate(dir: string): Promise<boolean> /* true when it switched */; renameSession(cwd: string | undefined, id: string, title: string): Promise<string | undefined>; setSessionFlag(cwd: string | undefined, id: string, flag: SessionFlag, on: boolean): Promise<void>; close(): Promise<void> }`
  - `createWorkspaces(opts: { cwd: string; home: string; host: ChatHost; hub: Hub; createHost(cwd: string): Promise<ChatHost>; readSessions(cwd: string): Promise<SessionRow[]> }): Workspaces` — `host` must already be open; adds `cwd` to the folder list.

- [ ] **Step 1: Write the failing tests** — `packages/cli/test/serve-workspaces.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ChatHost, HostEvent, SessionEvent } from "../dist/host.js";
import { listDirs, makeDir } from "../dist/serve/fs.js";
import { createHub } from "../dist/serve/hub.js";
import { createWorkspaces } from "../dist/serve/workspaces.js";
import { loadWorkspaces } from "../dist/workspaces.js";

const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

test("listDirs: folders only, hidden skipped, sorted; makeDir validates names", () => {
  const root = tmp("tah-fs-");
  mkdirSync(path.join(root, "b"));
  mkdirSync(path.join(root, "a"));
  mkdirSync(path.join(root, ".git"));
  writeFileSync(path.join(root, "file.txt"), "x");
  const listing = listDirs(root, "/unused");
  assert.equal(listing.path, root);
  assert.equal(listing.parent, path.dirname(root));
  assert.deepEqual(listing.dirs, ["a", "b"]);
  assert.equal(listDirs(undefined, root).path, root);
  assert.equal(listDirs("/", root).parent, null);
  assert.throws(() => listDirs(path.join(root, "file.txt"), root), /not a readable folder/);
  assert.throws(() => listDirs(path.join(root, "nope"), root), /not a readable folder/);

  assert.equal(makeDir(root, "c"), path.join(root, "c"));
  for (const bad of ["", ".", "..", "x/y", "x\\y", "a"]) assert.throws(() => makeDir(root, bad));
});

/** Fake hosts: `open()` emits a notice and a session; `close()` is recorded. */
function hostFactory() {
  const closed: string[] = [];
  const make = async (cwd: string): Promise<ChatHost> => {
    if (cwd.endsWith("broken")) throw new Error("tah: tah.config.json: bad");
    const listeners = new Set<(e: HostEvent) => void>();
    const snap: SessionEvent = { type: "session", id: `s-${path.basename(cwd)}`, resumed: false, history: [], hiddenTurns: 0 };
    return {
      sessionId: snap.id,
      approve: true,
      on(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      async open() {
        for (const l of listeners) l({ type: "notice", text: `boot ${cwd}` });
        for (const l of listeners) l(snap);
      },
      snapshot: () => snap,
      listSessions: async () => [{ id: snap.id, state: "idle", turns: 0, updatedAt: 1, preview: cwd }],
      renameSession: async () => "renamed-active",
      setSessionFlag: async () => {},
      async close() {
        closed.push(cwd);
      },
    } as unknown as ChatHost;
  };
  return { make, closed };
}

test("activate swaps hosts; failure keeps the old folder; list covers every folder", async () => {
  const home = tmp("tah-ws-home-");
  const a = tmp("tah-ws-a-");
  const b = tmp("tah-ws-b-");
  const broken = path.join(tmp("tah-ws-"), "broken");
  mkdirSync(broken);
  const gone = path.join(tmp("tah-ws-"), "gone");
  const { make, closed } = hostFactory();
  const first = await make(a);
  const hub = createHub(first);
  await first.open();
  const ws = createWorkspaces({
    cwd: a,
    home,
    host: first,
    hub,
    createHost: make,
    readSessions: async (cwd) => {
      if (cwd === b) return [{ id: "old-b", state: "completed", turns: 1, updatedAt: 1, preview: "b" }];
      return [];
    },
  });
  assert.deepEqual(loadWorkspaces(home), [a]);

  assert.throws(() => ws.add(gone), /not a folder/);
  ws.add(b);
  ws.add(broken);
  assert.throws(() => ws.remove(a), /active/);

  const seen: HostEvent[] = [];
  hub.subscribe((e) => seen.push(e));
  seen.length = 0;

  await assert.rejects(ws.activate(path.join(home, "not-listed")), /not in the folder list/);
  await assert.rejects(ws.activate(broken), /tah.config.json/);
  assert.equal(ws.cwd, a);
  assert.equal(ws.host, first);

  assert.equal(await ws.activate(b), true);
  assert.equal(await ws.activate(b), false);
  assert.equal(ws.cwd, b);
  assert.deepEqual(closed, [a]);
  assert.deepEqual(seen.map((e) => e.type), ["notice", "session"]);

  const views = await ws.list();
  assert.deepEqual(
    views.map((v) => [v.path, v.active, v.sessions.map((s) => s.id)]),
    [
      [a, false, []],
      [b, true, [`s-${path.basename(b)}`]],
      [broken, false, []],
    ],
  );

  writeFileSync(path.join(home, ".tah", "workspaces.json"), JSON.stringify({ workspaces: [a, b, gone] }));
  const missing = (await ws.list()).find((v) => v.path === gone);
  assert.equal(missing?.missing, true);
});

test("rename / flag on a non-active folder write that folder's files", async () => {
  const home = tmp("tah-ws-home-");
  const a = tmp("tah-ws-a-");
  const b = tmp("tah-ws-b-");
  const { make } = hostFactory();
  const first = await make(a);
  const hub = createHub(first);
  await first.open();
  const ws = createWorkspaces({
    cwd: a,
    home,
    host: first,
    hub,
    createHost: make,
    readSessions: async (cwd) => (cwd === b ? [{ id: "old-b", state: "completed", turns: 1, updatedAt: 1, preview: "b" }] : []),
  });
  ws.add(b);
  assert.equal(await ws.renameSession(undefined, "s-a", "x"), "renamed-active");
  assert.equal(await ws.renameSession(b, "old-b", "Named"), "Named");
  await ws.setSessionFlag(b, "old-b", "pinned", true);
  const { loadSessionFlags } = await import("../dist/session-flags.js");
  assert.deepEqual(loadSessionFlags(b).pinned, ["old-b"]);
  await assert.rejects(ws.renameSession(b, "nope", "x"), /no session/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/serve-workspaces.test.ts`
Expected: FAIL — cannot find `../dist/serve/fs.js`.

- [ ] **Step 3: Implement protocol types** — append to `packages/cli/src/serve/protocol.ts` (and add `import type { SessionRow } from "../sessions.js";` at the top):

```ts
/** `GET /api/workspaces`: one entry per folder in the sidebar. */
export type WorkspaceView = {
  path: string;
  name: string;
  active: boolean;
  missing?: true;
  /** Why this folder's sessions could not be read. */
  error?: string;
  sessions: SessionRow[];
};

/** `GET /api/fs`: sub-folders of `path`; `parent` is null at the root. */
export type DirListing = { path: string; parent: string | null; dirs: string[] };
```

In `packages/cli/src/index.ts` change the protocol export line to:

```ts
export type { DirListing, ServeError, ServeInfo, ServeRequest, WorkspaceView } from "./serve/protocol.js";
```

- [ ] **Step 4: Implement `packages/cli/src/serve/fs.ts`**:

```ts
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DirListing } from "./protocol.js";

/** Sub-folder names of `dir` (default `home`) for the folder picker; never files or contents. */
export function listDirs(dir: string | undefined, home: string): DirListing {
  const target = path.resolve(dir || home);
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch {
    throw new Error(`not a readable folder: ${target}`);
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((x, y) => x.localeCompare(y));
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, dirs };
}

export function makeDir(parent: string, name: string): string {
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) throw new Error(`invalid folder name: "${name}"`);
  const target = path.join(path.resolve(parent), name);
  if (existsSync(target)) throw new Error(`already exists: ${target}`);
  mkdirSync(target);
  return target;
}
```

- [ ] **Step 5: Implement `packages/cli/src/serve/workspaces.ts`**:

```ts
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { ChatHost, HostEvent } from "../host.js";
import { setSessionFlag, type SessionFlag } from "../session-flags.js";
import { setSessionTitle } from "../session-titles.js";
import type { SessionRow } from "../sessions.js";
import { addWorkspace, loadWorkspaces, removeWorkspace } from "../workspaces.js";
import { BusyError, type Hub } from "./hub.js";
import type { WorkspaceView } from "./protocol.js";

/** Answered as HTTP 409. */
export class ConflictError extends Error {}

export type Workspaces = {
  readonly cwd: string;
  readonly host: ChatHost;
  list(): Promise<WorkspaceView[]>;
  add(dir: string): void;
  remove(dir: string): void;
  /** Opens `dir` and moves every tab to it; false when it already was current. On failure the current folder stays. */
  activate(dir: string): Promise<boolean>;
  renameSession(cwd: string | undefined, id: string, title: string): Promise<string | undefined>;
  setSessionFlag(cwd: string | undefined, id: string, flag: SessionFlag, on: boolean): Promise<void>;
  close(): Promise<void>;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One open `ChatHost` at a time; `host` must already be open. */
export function createWorkspaces(opts: {
  cwd: string;
  home: string;
  host: ChatHost;
  hub: Hub;
  createHost(cwd: string): Promise<ChatHost>;
  readSessions(cwd: string): Promise<SessionRow[]>;
}): Workspaces {
  let current = { cwd: path.resolve(opts.cwd), host: opts.host };
  let switching = false;
  addWorkspace(opts.home, current.cwd);

  const listed = (dir: string): string => {
    const target = path.resolve(dir);
    if (target !== current.cwd && !loadWorkspaces(opts.home).includes(target)) {
      throw new Error(`not in the folder list: ${target}`);
    }
    return target;
  };

  /** Other folders: check the session exists in their db before writing their sidebar files. */
  const other = async (cwd: string | undefined, id: string): Promise<string | undefined> => {
    if (cwd === undefined) return undefined;
    const target = listed(cwd);
    if (target === current.cwd) return undefined;
    if (!(await opts.readSessions(target)).some((r) => r.id === id)) throw new Error(`no session "${id}"`);
    return target;
  };

  return {
    get cwd() {
      return current.cwd;
    },
    get host() {
      return current.host;
    },
    async list() {
      const dirs = loadWorkspaces(opts.home);
      if (!dirs.includes(current.cwd)) dirs.unshift(current.cwd);
      return Promise.all(
        dirs.map(async (dir): Promise<WorkspaceView> => {
          const view = { path: dir, name: path.basename(dir) || dir, active: dir === current.cwd };
          if (view.active) return { ...view, sessions: await current.host.listSessions() };
          if (!existsSync(dir)) return { ...view, missing: true, sessions: [] };
          try {
            return { ...view, sessions: await opts.readSessions(dir) };
          } catch (err) {
            return { ...view, error: message(err), sessions: [] };
          }
        }),
      );
    },
    add(dir) {
      const target = path.resolve(dir);
      if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`not a folder: ${target}`);
      addWorkspace(opts.home, target);
    },
    remove(dir) {
      const target = path.resolve(dir);
      if (target === current.cwd) throw new ConflictError("the active folder cannot be removed — switch to another first");
      removeWorkspace(opts.home, target);
    },
    async activate(dir) {
      const target = listed(dir);
      if (target === current.cwd) return false;
      opts.hub.assertIdle();
      if (switching) throw new BusyError();
      switching = true;
      try {
        const next = await opts.createHost(target);
        const buffered: HostEvent[] = [];
        const off = next.on((event) => buffered.push(event));
        try {
          await next.open();
        } catch (err) {
          off();
          await next.close().catch(() => {});
          throw err;
        }
        off();
        opts.hub.swap(next, buffered);
        const previous = current.host;
        current = { cwd: target, host: next };
        await previous.close();
        return true;
      } finally {
        switching = false;
      }
    },
    async renameSession(cwd, id, title) {
      const target = await other(cwd, id);
      return target ? setSessionTitle(target, id, title) : current.host.renameSession(id, title);
    },
    async setSessionFlag(cwd, id, flag, on) {
      const target = await other(cwd, id);
      if (target) setSessionFlag(target, id, flag, on);
      else await current.host.setSessionFlag(id, flag, on);
    },
    close: () => current.host.close(),
  };
}
```

Check `setSessionTitle`'s return type in `packages/cli/src/session-titles.ts` — it returns the stored title (`string | undefined`); if it is `void`, return `title.trim() || undefined` instead.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @typescript-agent-harness/cli build && pnpm --filter @typescript-agent-harness/cli test`
Expected: all pass.

- [ ] **Step 7: Commit** — `feat(cli): serve 工作区管理与目录浏览`

---

### Task 4: HTTP endpoints and `startServe` wiring

**Files:**
- Modify: `packages/cli/src/serve/http.ts`, `packages/cli/src/serve/run.ts`, `packages/cli/src/serve/protocol.ts`
- Test: `packages/cli/test/serve.test.ts`

**Interfaces:**
- Consumes: Task 3 `createWorkspaces`, `Workspaces`, `ConflictError`, `listDirs`, `makeDir`; Task 1 `readSavedSessions`.
- Produces:
  - `ServeOptions` = `{ workspaces: Workspaces; hub: Hub; token; info; webDir; persist; home: string }` (replaces `host`).
  - `startServe(flags: CliFlags, opts?: { homeDir?: string })`.
  - `ServeRequest` additions: `reset: { cwd?: string }`, `resume: { ref: string; cwd?: string }`, `fork: { turns?: number; id?: string; cwd?: string }`, `rename: { id: string; title: string; cwd?: string }`, `sessionFlag: { id; flag; on; cwd?: string }`, `workspace: { path: string }`, `mkdir: { path: string; name: string }`.

- [ ] **Step 1: Write the failing tests** — in `packages/cli/test/serve.test.ts`:

1. Add imports: `import { createWorkspaces } from "../dist/serve/workspaces.js";` and `readFileSync` to the `node:fs` import.
2. Replace `fakeServer` so it builds a manager around the fake host (home is a temp dir):

```ts
async function fakeServer(webDir = path.join(tmpdir(), "tah-no-web")) {
  const fake = fakeHost();
  const hub = createHub(fake.host);
  await fake.host.open();
  const home = mkdtempSync(path.join(tmpdir(), "tah-serve-home-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-serve-cwd-"));
  const workspaces = createWorkspaces({
    cwd,
    home,
    host: fake.host,
    hub,
    createHost: async () => fakeHost().host,
    readSessions: async () => [],
  });
  const { handle, closeAll } = createServeHandler({
    workspaces,
    hub,
    token: TOKEN,
    info: { approve: true, maxSteps: null, version: "0.0.0", vision: false },
    webDir,
    persist: true,
    home,
  });
  const server = createServer(handle);
  const base = await listen(server);
  return {
    ...fake,
    base,
    home,
    cwd,
    cookie: `tah_token_${new URL(base).port}=${TOKEN}`,
    async close() {
      closeAll();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
```

3. In the end-to-end test, start serve with a temp home: `const home = mkdtempSync(path.join(tmpdir(), "tah-serve-home-"));` and `startServe({ ...parseArgv([...]), cwd }, { homeDir: home })`. After the existing session-flag assertions, append:

```ts
    const aId = serve.sessionId;
    const b = mkdtempSync(path.join(tmpdir(), "tah-serve-b-"));
    assert.equal((await api.post("/api/workspaces/add", { path: b })).status, 204);
    const from = tab.events.length;
    assert.equal((await api.post("/api/reset", { cwd: b })).status, 204);
    const inB = (await tab.until("session", from)).at(-1) as SessionEvent;
    assert.notEqual(inB.id, aId);
    assert.equal(serve.sessionId, inB.id);
    const views = JSON.parse((await api.get("/api/workspaces")).body) as Array<{ path: string; active: boolean; sessions: Array<{ id: string }> }>;
    assert.deepEqual(views.map((v) => [v.path, v.active]), [
      [path.resolve(cwd), false],
      [path.resolve(b), true],
    ]);
    assert.ok(views[0]?.sessions.some((s) => s.id === aId));
    assert.equal(views[1]?.sessions.length, 1, "switching reuses the empty session it opened");
    assert.ok(existsSync(path.join(b, ".tah", "cli.db")));

    assert.equal((await api.post("/api/resume", { ref: aId, cwd })).status, 204);
    assert.equal(serve.sessionId, aId);
    assert.equal(JSON.parse((await api.get("/api/workspaces")).body)[0].active, true);

    writeFileSync(path.join(b, "tah.config.json"), "{");
    assert.equal((await api.post("/api/reset", { cwd: b })).status, 400);
    assert.equal(JSON.parse((await api.get("/api/workspaces")).body)[0].active, true);
    assert.equal((await api.post("/api/workspaces/remove", { path: cwd })).status, 409);
    assert.equal((await api.post("/api/workspaces/remove", { path: b })).status, 204);
```

(Add `existsSync` to the `node:fs` import. `tah.config.json` with `{` makes `loadTahConfig` throw `ProjectError`, which surfaces as 400.)

4. Add a new test for the directory endpoints:

```ts
test("folder browser lists sub-folders only and creates folders", async () => {
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  try {
    mkdirSync(path.join(s.home, "proj"));
    mkdirSync(path.join(s.home, ".hidden"));
    writeFileSync(path.join(s.home, "note.txt"), "x");
    const listing = JSON.parse((await api.get("/api/fs")).body);
    assert.equal(listing.path, s.home);
    assert.deepEqual(listing.dirs, ["proj"]);
    const inner = JSON.parse((await api.get(`/api/fs?path=${encodeURIComponent(path.join(s.home, "proj"))}`)).body);
    assert.deepEqual(inner.dirs, []);
    assert.equal((await api.get(`/api/fs?path=${encodeURIComponent(path.join(s.home, "nope"))}`)).status, 400);
    const made = await api.post("/api/fs/mkdir", { path: s.home, name: "fresh" });
    assert.equal(made.status, 201);
    assert.equal(JSON.parse(made.body).path, path.join(s.home, "fresh"));
    assert.equal((await api.post("/api/fs/mkdir", { path: s.home, name: "../x" })).status, 400);
    assert.equal((await api.post("/api/fs/mkdir", { path: s.home, name: "fresh" })).status, 400);
  } finally {
    await s.close();
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @typescript-agent-harness/cli build && node --test --experimental-strip-types packages/cli/test/serve.test.ts`
Expected: FAIL (build type errors on `workspaces` option, or 404 for `/api/workspaces`).

- [ ] **Step 3: Update `protocol.ts` `ServeRequest`**:

```ts
export type ServeRequest = {
  auth: { token: string };
  send: { text?: string; attachmentIds?: string[] };
  answer: { id: string; answer: ApprovalAnswer };
  /** `cwd`: start the session in that folder (switching to it first). */
  reset: { cwd?: string };
  resume: { ref: string; cwd?: string };
  /** `id`: fork that session (switching folder / session first) instead of the current one. */
  fork: { turns?: number; id?: string; cwd?: string };
  rename: { id: string; title: string; cwd?: string };
  sessionFlag: { id: string; flag: "pinned" | "archived"; on: boolean; cwd?: string };
  workspace: { path: string };
  mkdir: { path: string; name: string };
};
```

- [ ] **Step 4: Update `http.ts`**

- Imports: replace `import type { ChatHost } from "../host.js";` with
  `import { listDirs, makeDir } from "./fs.js";` and `import { ConflictError, type Workspaces } from "./workspaces.js";`
- `ServeOptions`: replace `host: ChatHost;` with `workspaces: Workspaces;` and add `/** Starting point of the folder picker. */ home: string;`
- Add a helper after `str`:

```ts
function optStr(body: Record<string, unknown>, key: string): string | undefined {
  return body[key] === undefined ? undefined : str(body, key);
}
```

- In `createServeHandler`: `const { workspaces, hub } = opts; const host = () => workspaces.host;` and replace every `host.` call in the switch with `host().` (`listSessions`, `saveAttachment`, `send`, `continueTurn`, `cancel`, `answer`).
- Add a persist guard helper inside `createServeHandler`:

```ts
  const needPersist = () => {
    if (!opts.persist) throw new HttpError(409, "sessions are only saved with persist on (drop --no-persist)");
  };
  /** Switches folder when the body names one; true when it switched. */
  const enter = async (cwd: string | undefined): Promise<boolean> => {
    if (cwd === undefined) return false;
    needPersist();
    return workspaces.activate(cwd);
  };
```

  and use `needPersist()` in place of the three existing inline persist checks.
- Replace the reset / resume / fork / rename / session-flag cases, and add the new ones:

```ts
      case "POST /api/reset": {
        const cwd = optStr(await readBody(req), "cwd");
        hub.assertIdle();
        // Opening a folder already lands on its latest session; reuse it when that one is still empty.
        const switched = await enter(cwd);
        if (!(switched && host().snapshot().history.length === 0)) await host().reset();
        return json(res, 204);
      }
      case "POST /api/resume": {
        const body = await readBody(req);
        const ref = str(body, "ref");
        hub.assertIdle();
        await enter(optStr(body, "cwd"));
        await host().resume(ref);
        return json(res, 204);
      }
      case "POST /api/fork": {
        const body = await readBody(req);
        const turns = body.turns;
        if (turns !== undefined && !(Number.isInteger(turns) && (turns as number) >= 0)) {
          throw new HttpError(400, '"turns" must be a non-negative integer');
        }
        const id = optStr(body, "id");
        hub.assertIdle();
        await enter(optStr(body, "cwd"));
        if (id !== undefined && id !== host().sessionId) await host().resume(id);
        await host().fork(turns as number | undefined);
        return json(res, 204);
      }
      case "POST /api/rename": {
        needPersist();
        const body = await readBody(req);
        const id = str(body, "id");
        if (typeof body.title !== "string") throw new HttpError(400, '"title" must be a string');
        hub.assertIdle();
        const title = await workspaces.renameSession(optStr(body, "cwd"), id, body.title);
        return json(res, 200, { id, title: title ?? null });
      }
      case "POST /api/session-flag": {
        needPersist();
        const body = await readBody(req);
        const id = str(body, "id");
        if (body.flag !== "pinned" && body.flag !== "archived") {
          throw new HttpError(400, '"flag" must be "pinned" or "archived"');
        }
        if (typeof body.on !== "boolean") throw new HttpError(400, '"on" must be a boolean');
        await workspaces.setSessionFlag(optStr(body, "cwd"), id, body.flag, body.on);
        return json(res, 204);
      }
      case "GET /api/workspaces":
        needPersist();
        return json(res, 200, await workspaces.list());
      case "POST /api/workspaces/add":
        workspaces.add(str(await readBody(req), "path"));
        return json(res, 204);
      case "POST /api/workspaces/remove":
        workspaces.remove(str(await readBody(req), "path"));
        return json(res, 204);
      case "GET /api/fs": {
        const dir = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("path") ?? undefined;
        return json(res, 200, listDirs(dir, opts.home));
      }
      case "POST /api/fs/mkdir": {
        const body = await readBody(req);
        return json(res, 201, { path: makeDir(str(body, "path"), str(body, "name")) });
      }
```

- In the `handle` error mapping, add before the generic 400: `if (err instanceof ConflictError) return json(res, 409, { error: err.message });`

- [ ] **Step 5: Update `run.ts`**

```ts
import os from "node:os";
import { readSavedSessions } from "../runtime.js";
import { createWorkspaces } from "./workspaces.js";
// ...
export async function startServe(
  flags: CliFlags,
  opts: { homeDir?: string } = {},
): Promise<{ url: string; readonly sessionId: string; stop(): Promise<void> }> {
  const home = opts.homeDir ?? os.homedir();
  const hostFor = (cwd: string) =>
    createChatHost({ ...flags, cwd, session: "" }, { historyTurns: Infinity, homeDir: home });
  const host = await createChatHost(flags, { historyTurns: Infinity, homeDir: home });
  const hub = createHub(host);
  // ...token / pkg unchanged...
  const workspaces = createWorkspaces({ cwd: flags.cwd, home, host, hub, createHost: hostFor, readSessions: readSavedSessions });
  const { handle, closeAll } = createServeHandler({ workspaces, hub, token, info: { ... }, webDir: ..., persist: flags.persist, home });
```

`createWorkspaces` must run after `host.open()` succeeds (its contract), so move it (and `createServeHandler`, which needs it) into the `try` after `await host.open();` — keep `listen` after. In the returned object use `workspaces.host` for `sessionId`, `workspaces.host.cancel()` and `await workspaces.close()` in `stop()`. In `runServe`, log `serve.sessionId` as before.

Note: `createWorkspaces` writes `~/.tah/workspaces.json`; `startServe` callers in tests must pass `homeDir`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @typescript-agent-harness/cli build && pnpm --filter @typescript-agent-harness/cli test`
Expected: all pass. Also `grep -rn "startServe(" packages/cli/test` — every call passes `{ homeDir }`.

- [ ] **Step 7: Commit** — `feat(cli): serve 工作文件夹接口与按文件夹切换`

---

### Task 5: Web UI — folder groups, folder picker, status bar

**Files:**
- Create: `packages/web/src/components/FolderPicker.tsx`
- Modify: `packages/web/src/api.ts`, `packages/web/src/App.tsx`, `packages/web/src/components/Sidebar.tsx`, `packages/web/src/components/StatusBar.tsx`, `packages/web/src/styles.css`

**Interfaces:**
- Consumes: Task 3/4 types `WorkspaceView`, `DirListing`, `ServeRequest` from `@typescript-agent-harness/cli`.

- [ ] **Step 1: `api.ts`** — add `DirListing, WorkspaceView` to the type import; remove `sessions` (no longer used); change `reset` and add:

```ts
  reset: (body: ServeRequest["reset"] = {}) => post("/api/reset", body),
  workspaces: async () => (await (await call("GET", "/api/workspaces")).json()) as WorkspaceView[],
  addWorkspace: (body: ServeRequest["workspace"]) => post("/api/workspaces/add", body),
  removeWorkspace: (body: ServeRequest["workspace"]) => post("/api/workspaces/remove", body),
  fs: async (path?: string) =>
    (await (await call("GET", `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`)).json()) as DirListing,
  mkdir: async (body: ServeRequest["mkdir"]) => (await (await call("POST", "/api/fs/mkdir", body)).json()) as { path: string },
```

- [ ] **Step 2: `StatusBar.tsx`** — add a `cwd` prop shown first:

```tsx
export function StatusBar(props: { cwd: string | undefined; model: string | undefined; sessionId: string; rounds: number; approve: boolean }) {
  const parts = [props.cwd, props.model ?? "tah", props.sessionId, `${props.rounds} rounds`, ...(props.approve ? [] : ["approve=off"])];
  return <div className="status">{parts.filter(Boolean).join(" · ")}</div>;
}
```

- [ ] **Step 3: `FolderPicker.tsx`**:

```tsx
import type { DirListing } from "@typescript-agent-harness/cli";
import { useEffect, useState } from "react";
import { api } from "../api";

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));
const join = (dir: string, name: string) => `${dir.replace(/[\\/]$/, "")}/${name}`;

/** Browse sub-folders from home, optionally create one, then open it as a workspace. */
export function FolderPicker(props: { onOpen(path: string): Promise<void>; onClose(): void }) {
  const [listing, setListing] = useState<DirListing>();
  const [error, setError] = useState<string>();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const { onClose } = props;

  const go = (path?: string) =>
    api.fs(path).then(
      (next) => {
        setListing(next);
        setError(undefined);
      },
      (err: unknown) => setError(text(err)),
    );

  useEffect(() => {
    void go();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const crumbs = (listing?.path ?? "").split(/[\\/]/).filter(Boolean);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Add folder">
        <div className="crumbs">
          <button type="button" onClick={() => void go("/")}>/</button>
          {crumbs.map((part, i) => (
            <button key={i} type="button" onClick={() => void go(`/${crumbs.slice(0, i + 1).join("/")}`)}>
              {part}/
            </button>
          ))}
        </div>
        <ul className="dirs">
          {listing?.parent ? (
            <li>
              <button type="button" onClick={() => void go(listing.parent ?? undefined)}>..</button>
            </li>
          ) : null}
          {listing?.dirs.map((d) => (
            <li key={d}>
              <button type="button" onClick={() => void go(join(listing.path, d))}>{d}</button>
            </li>
          ))}
        </ul>
        {naming && listing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              api.mkdir({ path: listing.path, name: name.trim() }).then(
                (made) => {
                  setNaming(false);
                  setName("");
                  return go(made.path);
                },
                (err: unknown) => setError(text(err)),
              );
            }}
          >
            <input
              autoFocus
              className="session-rename"
              value={name}
              placeholder="New folder name"
              aria-label="New folder name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNaming(false);
                }
              }}
            />
          </form>
        ) : null}
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="card-actions">
          <button type="button" disabled={!listing} onClick={() => setNaming(true)}>
            New folder
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!listing}
            onClick={() => listing && props.onOpen(listing.path).catch((err: unknown) => setError(text(err)))}
          >
            Open this folder
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `Sidebar.tsx`** — rework to folder groups. Keep `time`, `ago`, `label`, `PinIcon`, `ArchiveIcon`, the menu-closing effect, and the rename form exactly as they are now. Changes:

  - Props:

```tsx
  workspaces: WorkspaceView[] | undefined;
  unavailable: string | undefined;
  current: string;
  busy: boolean;
  onNew(cwd?: string): void;
  onFork(id: string, cwd?: string): void;
  onPick(id: string, cwd: string): void;
  onRename(id: string, title: string, cwd: string): Promise<void>;
  onFlag(id: string, flag: Flag, on: boolean, cwd: string): void;
  onAddFolder(): void;
  onRemoveFolder(path: string): void;
```

  - `type Item = { session: SessionRow; ws: WorkspaceView };` — `menu` state holds `{ item: Item; x; y }`; `editing` holds the key `` `${ws.path}\n${session.id}` ``.
  - Collapsed folders, persisted:

```tsx
const COLLAPSED = "tah.collapsedWorkspaces";
function loadCollapsed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
// in the component:
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(dir) ? prev.filter((d) => d !== dir) : [...prev, dir];
      localStorage.setItem(COLLAPSED, JSON.stringify(next));
      return next;
    });
```

  - Derived lists:

```tsx
  const all = props.workspaces ?? [];
  const items = (ws: WorkspaceView) => ws.sessions.filter((s) => !s.archived).map((session) => ({ session, ws }));
  const pinned = all.flatMap(items).filter((i) => i.session.pinned);
```

  - `row(item: Item, showFolder: boolean)` — same markup as today's `row(s)` with: `isCurrent = item.ws.active && item.session.id === props.current`; pick `disabled={props.busy && !isCurrent}` and `onClick={() => !isCurrent && props.onPick(item.session.id, item.ws.path)}`; before the time: `{showFolder ? <span className="session-folder">{item.ws.name}</span> : null}`; hover buttons call `props.onFlag(id, flag, on, item.ws.path)`; rename commit calls `props.onRename(id, title, item.ws.path)`; `key={`${item.ws.path}\n${item.session.id}`}`.
  - Menu: Pin/Unpin and Archive call `onFlag(..., menu.item.ws.path)`; Rename → `startEdit(menu.item)`; Fork → `props.onFork(menu.item.session.id, menu.item.ws.path)` (disabled while busy); Copy ID unchanged.
  - Top actions:

```tsx
      <div className="sidebar-actions">
        <button type="button" onClick={() => props.onNew()} disabled={props.busy}>
          New session
        </button>
        <button type="button" onClick={() => props.onFork(props.current)} disabled={props.busy || !props.current}>
          Fork
        </button>
        <button type="button" onClick={props.onAddFolder} title="Add folder">
          Add folder
        </button>
      </div>
```

  - List body:

```tsx
      <div className="sessions">
        {pinned.length ? (
          <>
            <div className="sessions-heading">Pinned</div>
            <ul>{pinned.map((i) => row(i, true))}</ul>
          </>
        ) : null}
        {all.map((ws) => {
          const closed = collapsed.includes(ws.path);
          return (
            <section key={ws.path} className="ws">
              <div className={`ws-head${ws.active ? " active" : ""}${ws.missing ? " missing" : ""}`} title={ws.path}>
                <button type="button" className="ws-toggle" aria-expanded={!closed} onClick={() => toggle(ws.path)}>
                  <span className="ws-chevron">{closed ? "▸" : "▾"}</span>
                  <span className="ws-name">{ws.name}</span>
                </button>
                {ws.missing ? <span className="ws-note">folder not found</span> : null}
                <span className="ws-tools">
                  {ws.missing ? null : (
                    <button type="button" title="New session" aria-label={`New session in ${ws.name}`} disabled={props.busy} onClick={() => props.onNew(ws.path)}>
                      +
                    </button>
                  )}
                  {ws.active ? null : (
                    <button type="button" title="Remove from list" aria-label={`Remove ${ws.name}`} onClick={() => props.onRemoveFolder(ws.path)}>
                      ×
                    </button>
                  )}
                </span>
              </div>
              {closed ? null : (
                <>
                  {ws.error ? <div className="sidebar-note">{ws.error}</div> : null}
                  <ul>{items(ws).filter((i) => !i.session.pinned).map((i) => row(i, false))}</ul>
                </>
              )}
            </section>
          );
        })}
      </div>
```


- [ ] **Step 5: `App.tsx`**

  - Imports: `WorkspaceView` instead of `SessionRow`; `FolderPicker`.
  - State: replace `sessions` with `const [workspaces, setWorkspaces] = useState<WorkspaceView[]>();` and add `const [picking, setPicking] = useState(false);`
  - Refresh:

```tsx
  const refresh = useCallback(
    () =>
      api.workspaces().then(
        (rows) => {
          setWorkspaces(rows);
          setSessionsError(undefined);
        },
        (err: unknown) => setSessionsError(err instanceof Error ? err.message : String(err)),
      ),
    [],
  );

  useEffect(() => {
    if (connection !== "open" || state.busy) return;
    void refresh();
  }, [connection, state.busy, state.sessionId, state.turnsEnded, refresh]);
```

  - Sidebar props:

```tsx
      <Sidebar
        workspaces={workspaces}
        unavailable={sessionsError}
        current={state.sessionId}
        busy={state.busy}
        onNew={(cwd) => run(api.reset(cwd ? { cwd } : {}))}
        onFork={(id, cwd) => run(api.fork({ id, ...(cwd ? { cwd } : {}) }))}
        onPick={(id, cwd) => run(api.resume({ ref: id, cwd }))}
        onRename={async (id, title, cwd) => {
          await api.rename({ id, title, cwd });
          await refresh();
        }}
        onFlag={(id, flag, on, cwd) => run(api.sessionFlag({ id, flag, on, cwd }).then(refresh))}
        onAddFolder={() => setPicking(true)}
        onRemoveFolder={(path) => run(api.removeWorkspace({ path }).then(refresh))}
      />
      {picking ? (
        <FolderPicker
          onClose={() => setPicking(false)}
          onOpen={async (path) => {
            await api.addWorkspace({ path });
            await api.reset({ cwd: path });
            setPicking(false);
            await refresh();
          }}
        />
      ) : null}
```

  `onClose` must be stable for the picker's Escape effect: define `const closePicker = useCallback(() => setPicking(false), []);` and pass it.
  - StatusBar: `cwd={workspaces?.find((w) => w.active)?.path}`.

- [ ] **Step 6: `styles.css`** — append after the `.context-menu` rules:

```css
.ws-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 4px 2px 2px;
  font-size: 12px;
  color: var(--muted);
}
.ws-head.active .ws-name {
  color: var(--text);
  font-weight: 600;
}
.ws-head.missing {
  opacity: 0.6;
}
.ws-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 0 4px;
  color: inherit;
  font-size: 12px;
  text-align: left;
}
.ws-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-note {
  flex: none;
}
.ws-tools {
  flex: none;
  display: none;
  gap: 2px;
}
.ws-head:hover .ws-tools {
  display: flex;
}
.ws-tools button {
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 0 6px;
  line-height: 1.4;
}
.ws-tools button:hover {
  background: var(--panel);
  color: var(--text);
}
.session-folder {
  flex: none;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}
.session-item:hover .session-folder {
  display: none;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.3);
}
.modal {
  width: min(520px, 90vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}
.crumbs {
  display: flex;
  flex-wrap: wrap;
}
.crumbs button,
.dirs button {
  border: none;
  background: transparent;
  padding: 2px 4px;
  text-align: left;
}
.dirs {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  min-height: 160px;
}
.dirs button {
  width: 100%;
  padding: 4px 8px;
}
.dirs button:hover,
.crumbs button:hover {
  background: var(--panel);
}
.modal-error {
  color: var(--fail);
  font-size: 13px;
}
.spacer {
  flex: 1;
}
```

Check `.card-actions` already lays out as a flex row (`grep -n "card-actions" packages/web/src/styles.css`); if not, add `display: flex; gap: 8px;` scoped to `.modal .card-actions`.

- [ ] **Step 7: Build and manual check**

Run: `pnpm build` — expected: web `tsc` + vite build succeed.

Then start a mock serve in a temp folder with a temp HOME so the real `~/.tah` is untouched:
`D=$(mktemp -d) H=$(mktemp -d); cd $D && HOME=$H node <repo>/packages/cli/dist/cli.js --mock --no-exec --port 4792 serve`
In the browser (the printed URL): send a message; Add folder → browse → New folder "demo" → Open this folder; the sidebar shows two groups and the new folder is active (status bar path changes); click the first folder's session → switches back; pin a session in the other folder → appears in Pinned with its folder name; collapse a group and reload → stays collapsed; remove the non-active folder → group disappears.

- [ ] **Step 8: Commit** — `feat(web): 侧边栏按工作文件夹分组与添加文件夹`

---

### Task 6: Docs

**Files:**
- Modify: `docs/design/workspaces.md` (status line → `✅ 已实现（当前分支；计划随 v0.30 发布）`), `docs/design/serve.md`, `docs/guide/cli.md`, `CHANGELOG.md`

- [ ] **Step 1:** `docs/design/serve.md` — in 非目标, change「不做多会话并行（下一版再议）；同一时间只有一个当前会话」to also say multiple folders are supported via [工作文件夹](./workspaces.md) (still one current session). In the security section, add one line: the folder picker (`GET /api/fs`) lists folder names (not files) anywhere the user can read.
- [ ] **Step 2:** `docs/guide/cli.md` — in the `tah serve` section add a short paragraph: sidebar groups sessions by folder; "Add folder" browses / creates folders; the list is in `~/.tah/workspaces.json`; switching folders makes it the agent's working directory; `.env` stays the one loaded at startup.
- [ ] **Step 3:** `CHANGELOG.md` — add at the top:

```markdown
## Unreleased

Web (`tah serve`): **work folders** — the sidebar groups sessions by folder (Pinned stays on top, across folders); "Add folder" opens an in-page folder browser that can also create a folder; opening a session in another folder makes it the agent's working directory (one current session at a time). The folder list lives in `~/.tah/workspaces.json`. New endpoints: `GET /api/workspaces`, `POST /api/workspaces/add|remove`, `GET /api/fs`, `POST /api/fs/mkdir`; `reset` / `resume` / `fork` / `rename` / `session-flag` accept an optional `cwd`. Design: `docs/design/workspaces`.
```

- [ ] **Step 4: Commit** — `docs: 工作文件夹使用说明与 CHANGELOG`
