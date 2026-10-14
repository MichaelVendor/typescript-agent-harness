# macOS 客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `tah serve` 包成一个本机用的 macOS App（Apple Silicon、`.dmg`、不签名不公证），双击打开、回到上次的文件夹。

**Architecture:** 新增私有包 `apps/desktop`。Electron 主进程只做壳：读登录 shell 的环境变量，用 App 里自带的官方 Node 22 启动子进程 `node <Resources>/tah/dist/cli.js serve --cwd <文件夹> --port 0 --no-open`，从输出里读出地址，用沙箱窗口打开。退出时查 `GET /api/workspaces` 记下当前文件夹，再给子进程发 `SIGINT`。`packages/*` 一行不改。

**Tech Stack:** Electron 44.7.2、electron-builder 26.15.3、Node v22.23.3（darwin-arm64，打进 App）、TypeScript（`tsconfig.base.json`）、`node --test`。

**Spec:** `docs/design/desktop.md`

## Global Constraints

- `packages/*`（含 `cli`）一行不改，不出现 Electron 逻辑。每个任务提交前 `git diff --stat HEAD -- packages/` 必须为空。
- 客户端只用 `tah serve --cwd <文件夹> --port 0 --no-open` 和 `GET /api/workspaces`（带 cookie `tah_token_<端口>=<token>`）。
- 版本锁定：`electron` `44.7.2`、`electron-builder` `26.15.3`、Node `22.23.3`（`node-v22.23.3-darwin-arm64.tar.gz`，按官方 `SHASUMS256.txt` 校验）。
- 只出 arm64 `.dmg`，ad-hoc 签名：`mac.identity: "-"` + `mac.hardenedRuntime: false`。
- 和命令行共用 `~/.tah`；客户端自己只写 `~/.tah/desktop.json`（`{ "lastFolder": "<路径>" }`）。
- 测试和冒烟一律用临时 HOME，不碰真实 `~/.tah`。
- 对话框文案用英文，和网页界面一致（Retry / Quit、Restart / Quit）。
- 包名 `@typescript-agent-harness/desktop`，`private: true`，版本与仓库一致（现为 `0.33.0`，发版时和其它 `package.json` 一起改）。
- 构建命令 `pnpm --filter desktop dist`；不进 CI、不进发版流程。
- 提交走 `~/.cursor/skills/code-commit/SKILL.md`；不 push；不提交 `.superpowers/`。

## 已验证的事实（写计划前实测）

- `pnpm --filter @typescript-agent-harness/cli deploy --prod --legacy --config.node-linker=hoisted <目录>`：可部署到仓库内的目录，不改 lockfile；产物约 56MB，含 `dist/web/index.html`，`node <目录>/dist/cli.js --version` 输出 `0.33.0`。只剩 `node_modules/.bin/` 下 8 个软链接，删掉 `.bin` 即无软链接。无 `.node` 原生模块。
- 部署出的 tah 启动后输出两行：`[tah] serving <cwd> — Ctrl+C to stop`、`[tah] open http://127.0.0.1:<端口>/?token=<token>`；`SIGINT` 后输出 `[tah] stopping…` 并退出。
- `GET` 请求不做 origin 检查，只认 cookie `tah_token_<端口>`，值就是 token。
- `pnpm --filter desktop` 能匹配带 scope 的包名。
- macOS 的 `env -0` 可用；`os.userInfo().shell` 为 `/bin/zsh`。
- electron-builder 26.15.3 文档：`identity: "-"` 为显式 ad-hoc 签名，需配 `hardenedRuntime: false`。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `pnpm-workspace.yaml` | 加 `apps/*` |
| `apps/desktop/package.json` | 包信息、脚本、electron-builder 配置、Node 版本（`config.node`） |
| `apps/desktop/tsconfig.json` | 继承 `../../tsconfig.base.json`，`src` → `dist` |
| `apps/desktop/.gitignore` | `bundle/`、`release/` |
| `apps/desktop/src/state.ts` | 读写 `~/.tah/desktop.json` |
| `apps/desktop/src/shell-env.ts` | 跑登录 shell，解析 `env -0` |
| `apps/desktop/src/server.ts` | 启停 `tah serve` 子进程、读地址、查当前文件夹 |
| `apps/desktop/src/main.ts` | Electron 入口：单实例、启动流程、窗口、退出 |
| `apps/desktop/scripts/fetch-node.mjs` | 下载并校验 Node，放到 `bundle/node/bin/node` |
| `apps/desktop/scripts/prepare-tah.mjs` | `pnpm deploy` 到 `bundle/tah` 并自检 |
| `apps/desktop/test/state.test.ts` | state 单测 |
| `apps/desktop/test/shell-env.test.ts` | shell-env 单测 |
| `apps/desktop/test/server.test.ts` | server 单测 |
| `apps/desktop/test/fixtures/fake-cli.mjs` | 假的 `cli.js`，按 `FAKE_MODE` 模拟各种情况 |

测试照 `packages/cli` 的习惯：先 `build`，测试从 `../dist/*.js` 导入。staging 目录叫 `bundle/` 而不是 `build/`，因为 `build/` 是 electron-builder 默认的 buildResources 目录。

---

### Task 1: 新建 `apps/desktop` + `state.ts`

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/.gitignore`, `apps/desktop/src/state.ts`, `apps/desktop/test/state.test.ts`
- Modify: `pnpm-lock.yaml`（`pnpm install` 生成）

**Interfaces:**
- Produces:
  - `readLastFolder(home: string): string | undefined`：`<home>/.tah/desktop.json` 的 `lastFolder`，只在它是存在的目录时返回。
  - `writeLastFolder(home: string, folder: string): void`：建好 `<home>/.tah/`，写 `{ "lastFolder": folder }`。

- [ ] **Step 1: 加 workspace 目录**

`pnpm-workspace.yaml` 改为：

```yaml
packages:
  - "packages/*"
  - "examples/*"
  - "apps/*"
```

- [ ] **Step 2: 写 `apps/desktop/package.json`**

`build` 字段先只放 `appId`，打包配置在 Task 5 补全。

```json
{
  "name": "@typescript-agent-harness/desktop",
  "productName": "tah",
  "version": "0.33.0",
  "private": true,
  "description": "macOS app for tah serve",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "node --test --experimental-strip-types test/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^22.18.0",
    "electron": "44.7.2",
    "electron-builder": "26.15.3",
    "typescript": "^5.9.2"
  },
  "build": {
    "appId": "dev.tah.desktop"
  }
}
```

- [ ] **Step 3: 写 `apps/desktop/tsconfig.json` 和 `.gitignore`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`apps/desktop/.gitignore`：

```text
bundle/
release/
```

- [ ] **Step 4: 安装依赖**

Run（需要网络）：`pnpm install`
Expected：成功；可能提示 `Ignored build scripts: electron` —— 正常，打包时 electron-builder 自己下载 Electron，类型定义在 npm 包里已有。`pnpm-lock.yaml` 出现 `apps/desktop`。

- [ ] **Step 5: 写失败的测试 `apps/desktop/test/state.test.ts`**

```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readLastFolder, writeLastFolder } from "../dist/state.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "tah-desktop-"));
const file = (home: string) => path.join(home, ".tah", "desktop.json");

test("no desktop.json gives undefined", () => {
  assert.equal(readLastFolder(tmp()), undefined);
});

test("reads back the folder it wrote", () => {
  const home = tmp();
  const folder = tmp();
  writeLastFolder(home, folder);
  assert.equal(readLastFolder(home), folder);
});

test("a deleted folder gives undefined", () => {
  const home = tmp();
  const folder = tmp();
  writeLastFolder(home, folder);
  rmSync(folder, { recursive: true });
  assert.equal(readLastFolder(home), undefined);
});

test("a file instead of a folder gives undefined", () => {
  const home = tmp();
  const notDir = path.join(tmp(), "a.txt");
  writeFileSync(notDir, "x");
  writeLastFolder(home, notDir);
  assert.equal(readLastFolder(home), undefined);
});

test("broken JSON gives undefined", () => {
  const home = tmp();
  mkdirSync(path.join(home, ".tah"));
  writeFileSync(file(home), "{");
  assert.equal(readLastFolder(home), undefined);
});
```

- [ ] **Step 6: 跑测试，确认失败**

Run：`pnpm --filter desktop test`
Expected：FAIL，`Cannot find module '.../apps/desktop/dist/state.js'`。

- [ ] **Step 7: 写 `apps/desktop/src/state.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const file = (home: string) => path.join(home, ".tah", "desktop.json");

/** The folder the app had open last time, if it still exists. */
export function readLastFolder(home: string): string | undefined {
  let folder: unknown;
  try {
    folder = (JSON.parse(readFileSync(file(home), "utf8")) as { lastFolder?: unknown }).lastFolder;
  } catch {
    return undefined;
  }
  if (typeof folder !== "string" || !existsSync(folder) || !statSync(folder).isDirectory()) return undefined;
  return folder;
}

export function writeLastFolder(home: string, folder: string): void {
  mkdirSync(path.dirname(file(home)), { recursive: true });
  writeFileSync(file(home), `${JSON.stringify({ lastFolder: folder }, null, 2)}\n`);
}
```

- [ ] **Step 8: 编译并跑测试**

Run：`pnpm --filter desktop build && pnpm --filter desktop test`
Expected：5 个测试 PASS。

- [ ] **Step 9: 确认内核没动，提交**

Run：`git diff --stat HEAD -- packages/`
Expected：无输出。

按 code-commit 技能提交 `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`apps/desktop/{package.json,tsconfig.json,.gitignore,src/state.ts,test/state.test.ts}`。参考信息：`feat(desktop): 新增 apps/desktop，记录上次打开的文件夹`。

---

### Task 2: `shell-env.ts` 读登录 shell 环境

**Files:**
- Create: `apps/desktop/src/shell-env.ts`, `apps/desktop/test/shell-env.test.ts`

**Interfaces:**
- Produces:
  - `parseEnvDump(out: string): Record<string, string> | undefined`：取两个标记之间的 `env -0` 输出；没有标记返回 `undefined`。
  - `type ShellEnv = { env: NodeJS.ProcessEnv; error?: string }`
  - `loadShellEnv(opts?: { shell?: string; base?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<ShellEnv>`：成功返回 shell 的环境；失败（超时、启动失败、没打印标记）返回 `{ env: base, error }`。`shell` 默认 `os.userInfo().shell ?? "/bin/zsh"`，`base` 默认 `process.env`，`timeoutMs` 默认 `5000`。

- [ ] **Step 1: 写失败的测试 `apps/desktop/test/shell-env.test.ts`**

假 shell 是一个 `sh` 脚本：收到 `-ilc <脚本>`，用 `/bin/sh` 跑第二个参数。

```ts
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadShellEnv, parseEnvDump } from "../dist/shell-env.js";

const B = "__TAH_ENV_BEGIN__";
const E = "__TAH_ENV_END__";

function fakeShell(body: string): string {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "tah-shell-")), "fake-shell");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

test("parses the dump between the markers", () => {
  const out = `motd noise\n${B}A=1\0EMPTY=\0MULTI=line1\nline2\0EQ=a=b\0${E}trailing`;
  assert.deepEqual(parseEnvDump(out), { A: "1", EMPTY: "", MULTI: "line1\nline2", EQ: "a=b" });
});

test("no markers gives undefined", () => {
  assert.equal(parseEnvDump("A=1\0"), undefined);
  assert.equal(parseEnvDump(`${B}A=1\0`), undefined);
});

test("returns the login shell's environment", async () => {
  const shell = fakeShell('shift; exec /bin/sh -c "$1"');
  const result = await loadShellEnv({ shell, base: { PATH: "/usr/bin:/bin", FROM_BASE: "yes" } });
  assert.equal(result.error, undefined);
  assert.equal(result.env.FROM_BASE, "yes");
  assert.equal(result.env.DISABLE_AUTO_UPDATE, "true");
});

test("falls back to base when the shell hangs", async () => {
  const shell = fakeShell("exec sleep 10");
  const base = { PATH: "/usr/bin:/bin" };
  const started = Date.now();
  const result = await loadShellEnv({ shell, base, timeoutMs: 300 });
  assert.equal(result.env, base);
  assert.match(result.error ?? "", /timed out/);
  assert.ok(Date.now() - started < 3000);
});

test("falls back to base when the shell prints no markers", async () => {
  const result = await loadShellEnv({ shell: fakeShell("echo hello"), base: { PATH: "/usr/bin:/bin" } });
  assert.match(result.error ?? "", /no environment/);
});

test("falls back to base when the shell does not exist", async () => {
  const result = await loadShellEnv({ shell: "/nonexistent/shell", base: { PATH: "/usr/bin:/bin" } });
  assert.match(result.error ?? "", /ENOENT/);
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run：`pnpm --filter desktop test`
Expected：shell-env 测试 FAIL，`Cannot find module '.../dist/shell-env.js'`；state 测试仍 PASS。

- [ ] **Step 3: 写 `apps/desktop/src/shell-env.ts`**

```ts
import { spawn } from "node:child_process";
import os from "node:os";

const BEGIN = "__TAH_ENV_BEGIN__";
const END = "__TAH_ENV_END__";

export type ShellEnv = { env: NodeJS.ProcessEnv; error?: string };

/** The `env -0` dump printed between the markers; rc files may print around it. */
export function parseEnvDump(out: string): Record<string, string> | undefined {
  const start = out.indexOf(BEGIN);
  if (start === -1) return undefined;
  const end = out.indexOf(END, start + BEGIN.length);
  if (end === -1) return undefined;
  const env: Record<string, string> = {};
  for (const entry of out.slice(start + BEGIN.length, end).split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/** Apps opened from the Dock get a bare PATH; agent commands need the one from the user's shell rc files. */
export function loadShellEnv(
  opts: { shell?: string; base?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ShellEnv> {
  const base = opts.base ?? process.env;
  const shell = opts.shell ?? os.userInfo().shell ?? "/bin/zsh";
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ShellEnv) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // oh-my-zsh update prompts and tmux autostart would block a shell with no terminal.
    const child = spawn(shell, ["-ilc", `printf ${BEGIN}; env -0; printf ${END}`], {
      env: { ...base, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTART: "false" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ env: base, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", (err) => finish({ env: base, error: err.message }));
    child.on("close", () => {
      const env = parseEnvDump(out);
      finish(env ? { env } : { env: base, error: "the login shell printed no environment" });
    });
  });
}
```

- [ ] **Step 4: 编译并跑测试**

Run：`pnpm --filter desktop build && pnpm --filter desktop test`
Expected：state 5 个 + shell-env 6 个，全部 PASS。

- [ ] **Step 5: 用真实 zsh 看一眼（不写进测试）**

Run：`cd apps/desktop && node -e 'import("./dist/shell-env.js").then(async m => { const r = await m.loadShellEnv(); console.log(r.error ?? "ok", r.env.PATH) })'`
Expected：打印 `ok` 和含 Homebrew 路径（如 `/opt/homebrew/bin`）的 PATH。如果打印 `timed out`，记下用时，在报告里说明（不改超时）。

- [ ] **Step 6: 确认内核没动，提交**

Run：`git diff --stat HEAD -- packages/`
Expected：无输出。

按 code-commit 技能提交 `apps/desktop/src/shell-env.ts`、`apps/desktop/test/shell-env.test.ts`。参考信息：`feat(desktop): 读取登录 shell 的环境变量`。

---

### Task 3: `server.ts` 启停 `tah serve`

**Files:**
- Create: `apps/desktop/src/server.ts`, `apps/desktop/test/server.test.ts`, `apps/desktop/test/fixtures/fake-cli.mjs`

**Interfaces:**
- Produces:
  - `class StartError extends Error { readonly stderr: string }`：启动失败；`stderr` 是 stderr 最后 20 行。
  - `type Server = { readonly url: string; activeFolder(): Promise<string | undefined>; stop(): Promise<void> }`
  - `type ServerOptions = { node: string; cli: string; cwd: string; env: NodeJS.ProcessEnv; onExit(stderr: string): void; startTimeoutMs?: number; stopTimeoutMs?: number }`
  - `startServer(opts: ServerOptions): Promise<Server>`：跑 `node cli serve --cwd <cwd> --port 0 --no-open`，等 stdout 出现 `[tah] open <url>`（默认 30 秒）。超时、启动出错或提前退出时 reject `StartError`。启动后子进程不是因为 `stop()` 而退出时，调 `onExit(stderr 最后 20 行)`。
  - `activeFolder()`：带 cookie `tah_token_<端口>=<token>` 请求 `GET /api/workspaces`（3 秒超时），返回 `active: true` 那项的 `path`；任何失败返回 `undefined`。
  - `stop()`：发 `SIGINT`，`stopTimeoutMs`（默认 5000）后还在就 `SIGKILL`；进程退出后 resolve。

- [ ] **Step 1: 写假的 `cli.js`：`apps/desktop/test/fixtures/fake-cli.mjs`**

`FAKE_MODE`：`ok`（默认，正常服务）、`exit`（启动前出错退出）、`hang`（什么都不输出）、`stubborn`（忽略 `SIGINT`）、`crash`（启动后 100ms 崩溃）。

```js
import http from "node:http";

const mode = process.env.FAKE_MODE ?? "ok";
const args = process.argv.slice(2);
const cwd = args[args.indexOf("--cwd") + 1];

if (mode === "exit") {
  console.error("boom: no model configured");
  process.exit(1);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  const token = "secret";
  const server = http.createServer((req, res) => {
    const { port } = server.address();
    if (req.url !== "/api/workspaces" || req.headers.cookie !== `tah_token_${port}=${token}`) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ path: "/elsewhere", active: false }, { path: cwd, active: true }]));
  });
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    console.log(`[tah] serving ${cwd} — Ctrl+C to stop`);
    console.log(`[tah] open http://127.0.0.1:${port}/?token=${token}`);
    if (mode === "crash") {
      setTimeout(() => {
        console.error("crashed hard");
        process.exit(3);
      }, 100);
    }
  });
  process.on("SIGINT", () => {
    if (mode === "stubborn") return;
    console.log("[tah] stopping…");
    server.close();
    process.exit(0);
  });
}
```

- [ ] **Step 2: 写失败的测试 `apps/desktop/test/server.test.ts`**

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startServer, StartError } from "../dist/server.js";

const cli = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

function start(mode: string, extra: { onExit?: (stderr: string) => void; startTimeoutMs?: number; stopTimeoutMs?: number } = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "tah-server-"));
  const server = startServer({
    node: process.execPath,
    cli,
    cwd,
    env: { ...process.env, FAKE_MODE: mode },
    onExit: extra.onExit ?? (() => {}),
    ...(extra.startTimeoutMs ? { startTimeoutMs: extra.startTimeoutMs } : {}),
    ...(extra.stopTimeoutMs ? { stopTimeoutMs: extra.stopTimeoutMs } : {}),
  });
  return { cwd, server };
}

test("reads the url, reports the active folder, stops on SIGINT", async () => {
  let exits = 0;
  const { cwd, server } = start("ok", { onExit: () => exits++ });
  const s = await server;
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=secret$/);
  assert.equal(await s.activeFolder(), cwd);
  await s.stop();
  assert.equal(await s.activeFolder(), undefined);
  assert.equal(exits, 0);
});

test("exiting before ready rejects with the stderr tail", async () => {
  await assert.rejects(start("exit").server, (err: unknown) => {
    assert.ok(err instanceof StartError);
    assert.match(err.message, /exited/);
    assert.match(err.stderr, /boom: no model configured/);
    return true;
  });
});

test("no url within the timeout rejects", async () => {
  await assert.rejects(start("hang", { startTimeoutMs: 300 }).server, /did not start/);
});

test("a missing node binary rejects", async () => {
  const server = startServer({ node: "/nonexistent/node", cli, cwd: os.tmpdir(), env: process.env, onExit: () => {} });
  await assert.rejects(server, StartError);
});

test("stop falls back to SIGKILL", async () => {
  const s = await start("stubborn", { stopTimeoutMs: 300 }).server;
  const started = Date.now();
  await s.stop();
  assert.ok(Date.now() - started < 3000);
  assert.equal(await s.activeFolder(), undefined);
});

test("an unexpected exit calls onExit with the stderr tail", async () => {
  const stderr = await new Promise<string>((resolve, reject) => {
    start("crash", { onExit: resolve }).server.catch(reject);
  });
  assert.match(stderr, /crashed hard/);
});
```

- [ ] **Step 3: 跑测试，确认失败**

Run：`pnpm --filter desktop test`
Expected：server 测试 FAIL，`Cannot find module '.../dist/server.js'`；其它 PASS。

- [ ] **Step 4: 写 `apps/desktop/src/server.ts`**

```ts
import { spawn } from "node:child_process";

const OPEN_LINE = /^\[tah\] open (http:\/\/127\.0\.0\.1:(\d+)\/\?token=(\S+))$/m;
const TAIL_LINES = 20;

export class StartError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
  }
}

export type Server = {
  readonly url: string;
  /** The folder the web app has open now; undefined when tah does not answer. */
  activeFolder(): Promise<string | undefined>;
  /** SIGINT, then SIGKILL after `stopTimeoutMs`; resolves once the process is gone. */
  stop(): Promise<void>;
};

export type ServerOptions = {
  node: string;
  cli: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Called with the last stderr lines when tah exits on its own after it started. */
  onExit(stderr: string): void;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
};

export function startServer(opts: ServerOptions): Promise<Server> {
  const child = spawn(opts.node, [opts.cli, "serve", "--cwd", opts.cwd, "--port", "0", "--no-open"], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-64_000);
  });
  const tail = () => stderr.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
  let stopping = false;

  const server = (url: string, port: string, token: string): Server => ({
    url,
    async activeFolder() {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
          headers: { cookie: `tah_token_${port}=${token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return undefined;
        const list = (await res.json()) as { path: string; active: boolean }[];
        return list.find((w) => w.active)?.path;
      } catch {
        return undefined;
      }
    },
    async stop() {
      stopping = true;
      child.kill("SIGINT");
      const timer = setTimeout(() => child.kill("SIGKILL"), opts.stopTimeoutMs ?? 5000);
      await exited;
      clearTimeout(timer);
    },
  });

  return new Promise((resolve, reject) => {
    const startTimeoutMs = opts.startTimeoutMs ?? 30_000;
    let ready = false;
    const fail = (message: string) => {
      if (ready) return;
      ready = true;
      stopping = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      void exited.then(() => reject(new StartError(message, tail())));
    };
    const timer = setTimeout(() => fail(`tah did not start within ${startTimeoutMs / 1000}s`), startTimeoutMs);
    let out = "";
    // Keep reading after the url line so a full pipe never blocks tah.
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (ready) return;
      out += chunk;
      const m = OPEN_LINE.exec(out);
      if (!m) return;
      ready = true;
      clearTimeout(timer);
      resolve(server(m[1]!, m[2]!, m[3]!));
    });
    child.once("error", (err) => fail(err.message));
    child.once("exit", (code, signal) => {
      if (!ready) fail(`tah exited (${signal ?? `code ${code}`}) before it was ready`);
      else if (!stopping) opts.onExit(tail());
    });
  });
}
```

- [ ] **Step 5: 编译并跑测试**

Run：`pnpm --filter desktop build && pnpm --filter desktop test`
Expected：state 5 + shell-env 6 + server 6，全部 PASS。

- [ ] **Step 6: 用部署出的真 tah 冒烟（临时 HOME，不写进测试）**

```bash
rm -rf /tmp/tah-deploy && pnpm --filter @typescript-agent-harness/cli deploy --prod --legacy --config.node-linker=hoisted /tmp/tah-deploy
mkdir -p /tmp/tah-smoke-home /tmp/tah-smoke-cwd
cd apps/desktop && HOME=/tmp/tah-smoke-home node -e '
import("./dist/server.js").then(async ({ startServer }) => {
  const s = await startServer({ node: process.execPath, cli: "/tmp/tah-deploy/dist/cli.js", cwd: "/tmp/tah-smoke-cwd", env: process.env, onExit: (e) => console.log("EXIT", e) });
  console.log(s.url);
  console.log("active:", await s.activeFolder());
  await s.stop();
  console.log("stopped");
})'
```

Expected：打印地址、`active: /tmp/tah-smoke-cwd`、`stopped`，不打印 `EXIT`。

- [ ] **Step 7: 确认内核没动，提交**

Run：`git diff --stat HEAD -- packages/`
Expected：无输出。

按 code-commit 技能提交 `apps/desktop/src/server.ts`、`apps/desktop/test/server.test.ts`、`apps/desktop/test/fixtures/fake-cli.mjs`。参考信息：`feat(desktop): 启停 tah serve 子进程`。

---

### Task 4: `main.ts` Electron 入口

**Files:**
- Create: `apps/desktop/src/main.ts`

**Interfaces:**
- Consumes：
  - `readLastFolder(home)` / `writeLastFolder(home, folder)`（Task 1）
  - `loadShellEnv(): Promise<ShellEnv>`（Task 2）
  - `startServer(opts): Promise<Server>`、`StartError`（Task 3）
- Produces：`dist/main.js`（`package.json` 的 `main`）。资源路径约定：`<process.resourcesPath>/node/bin/node`、`<process.resourcesPath>/tah/dist/cli.js`（Task 5 按这个放）。

行为对照 spec：
- 启动：单实例锁（第二个实例把窗口拉到前面后退出），读登录 shell 环境（失败记一行日志），`lastFolder` 存在就用，否则弹「选文件夹」（可新建，取消就退出），启动失败弹框显示 stderr 尾部，按钮 Retry / Quit。启动成功后把文件夹写进 `desktop.json`（这样第一次选完、即使没正常退出，下次也能回来）。
- 运行：`window.open` / `target=_blank` 和跳到非本机地址的导航都交给系统浏览器（只放行 `http(s)`）；关窗口只隐藏，点 Dock 再显示；菜单用 Electron 默认菜单；子进程意外退出弹框 Restart / Quit。
- 退出：查当前文件夹写进 `desktop.json`（查不到保留原值），`stop()`，再真正退出。重复按 ⌘Q 不会重复发 `SIGINT`。

- [ ] **Step 1: 写 `apps/desktop/src/main.ts`**

```ts
import { app, BrowserWindow, dialog, shell } from "electron";
import os from "node:os";
import path from "node:path";
import { startServer, StartError, type Server } from "./server.js";
import { loadShellEnv } from "./shell-env.js";
import { readLastFolder, writeLastFolder } from "./state.js";

const home = os.homedir();
const node = path.join(process.resourcesPath, "node", "bin", "node");
const cli = path.join(process.resourcesPath, "tah", "dist", "cli.js");

let env: NodeJS.ProcessEnv = process.env;
let server: Server | undefined;
let win: BrowserWindow | undefined;
let origin = "";
let quitting = false;
let shuttingDown = false;
let stopped = false;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openExternal(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function load(url: string): void {
  origin = new URL(url).origin;
  if (!win) {
    win = new BrowserWindow({
      width: 1280,
      height: 840,
      title: "tah",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      openExternal(target);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event) => {
      if (new URL(event.url).origin === origin) return;
      event.preventDefault();
      openExternal(event.url);
    });
    win.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      win?.hide();
    });
  }
  void win.loadURL(url);
  showWindow();
}

async function pickFolder(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "Choose a folder for tah",
    buttonLabel: "Open",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
}

/** Starts tah in `folder`, offering Retry / Quit until it starts or the user quits. */
async function launch(folder: string): Promise<void> {
  for (;;) {
    let started: Server;
    try {
      started = await startServer({ node, cli, cwd: folder, env, onExit: (stderr) => void crashed(folder, stderr) });
    } catch (err) {
      const { response } = await dialog.showMessageBox({
        type: "error",
        message: `tah failed to start: ${message(err)}`,
        detail: err instanceof StartError ? err.stderr : "",
        buttons: ["Retry", "Quit"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 1) {
        app.quit();
        return;
      }
      continue;
    }
    server = started;
    writeLastFolder(home, folder);
    load(started.url);
    return;
  }
}

async function crashed(folder: string, stderr: string): Promise<void> {
  server = undefined;
  if (quitting) return;
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "tah stopped unexpectedly",
    detail: stderr,
    buttons: ["Restart", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 1) app.quit();
  else await launch(folder);
}

async function boot(): Promise<void> {
  const shellEnv = await loadShellEnv();
  if (shellEnv.error) console.error(`[desktop] using the app's environment — login shell: ${shellEnv.error}`);
  env = shellEnv.env;
  const folder = readLastFolder(home) ?? (await pickFolder());
  if (!folder) {
    app.quit();
    return;
  }
  await launch(folder);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  // The window only hides; keep running until ⌘Q.
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    quitting = true;
    const running = server;
    if (stopped || !running) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      const active = await running.activeFolder();
      try {
        if (active) writeLastFolder(home, active);
      } catch (err) {
        console.error(`[desktop] could not save the last folder: ${message(err)}`);
      }
      await running.stop();
      stopped = true;
      app.quit();
    })();
  });
  void app.whenReady().then(boot);
}
```

- [ ] **Step 2: 编译、类型检查、跑单测**

Run：`pnpm --filter desktop build && pnpm --filter desktop typecheck && pnpm --filter desktop test`
Expected：无类型错误；17 个测试 PASS。

- [ ] **Step 3: 确认内核没动，提交**

Run：`git diff --stat HEAD -- packages/`
Expected：无输出。

按 code-commit 技能提交 `apps/desktop/src/main.ts`。参考信息：`feat(desktop): Electron 入口：启动流程、窗口与退出`。

---

### Task 5: 打包 `.dmg`

**Files:**
- Create: `apps/desktop/scripts/fetch-node.mjs`, `apps/desktop/scripts/prepare-tah.mjs`
- Modify: `apps/desktop/package.json`（`config.node`、`dist` 脚本、完整 `build` 配置）

**Interfaces:**
- Consumes：`dist/main.js`（Task 4）；它期望 `Resources/node/bin/node`、`Resources/tah/dist/cli.js`。
- Produces：`apps/desktop/release/tah-0.33.0-arm64.dmg`、`apps/desktop/release/mac-arm64/tah.app`。

- [ ] **Step 1: 写 `apps/desktop/scripts/fetch-node.mjs`**

```js
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).config.node;
const name = `node-v${version}-darwin-arm64`;
const base = `https://nodejs.org/dist/v${version}`;
const out = path.join(root, "bundle", "node");
const stamp = path.join(root, "bundle", "node.version");

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version && existsSync(path.join(out, "bin", "node"))) {
  console.log(`node ${version} already in bundle/node`);
  process.exit(0);
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sums = (await get(`${base}/SHASUMS256.txt`)).toString("utf8");
const expected = sums
  .split("\n")
  .find((line) => line.endsWith(`  ${name}.tar.gz`))
  ?.split(" ")[0];
if (!expected) throw new Error(`${name}.tar.gz is not listed in SHASUMS256.txt`);
const tarball = await get(`${base}/${name}.tar.gz`);
const actual = createHash("sha256").update(tarball).digest("hex");
if (actual !== expected) throw new Error(`checksum mismatch for ${name}.tar.gz: got ${actual}, want ${expected}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "bin"), { recursive: true });
const archive = path.join(root, "bundle", `${name}.tar.gz`);
writeFileSync(archive, tarball);
execFileSync("tar", ["-xzf", archive, "-C", path.join(out, "bin"), "--strip-components=2", `${name}/bin/node`]);
rmSync(archive);
writeFileSync(stamp, version);
console.log(`node ${version} → bundle/node/bin/node`);
```

- [ ] **Step 2: 写 `apps/desktop/scripts/prepare-tah.mjs`**

```js
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "bundle", "tah");
const node = path.join(root, "bundle", "node", "bin", "node");

rmSync(out, { recursive: true, force: true });
// hoisted: a plain node_modules tree; pnpm's default layout is symlinks into .pnpm.
execFileSync(
  "pnpm",
  ["--filter", "@typescript-agent-harness/cli", "deploy", "--prod", "--legacy", "--config.node-linker=hoisted", out],
  { stdio: "inherit" },
);
rmSync(path.join(out, "node_modules", ".bin"), { recursive: true, force: true });

const links = execFileSync("find", [out, "-type", "l"], { encoding: "utf8" }).trim();
if (links) throw new Error(`symlinks left in bundle/tah:\n${links}`);
if (!existsSync(path.join(out, "dist", "web", "index.html"))) throw new Error("bundle/tah has no web app — run the root build first");
const want = JSON.parse(readFileSync(path.join(root, "..", "..", "packages", "cli", "package.json"), "utf8")).version;
const got = execFileSync(node, [path.join(out, "dist", "cli.js"), "--version"], { encoding: "utf8" }).trim();
if (got !== want) throw new Error(`bundled tah reports ${got}, expected ${want}`);
console.log(`tah ${got} → bundle/tah`);
```

- [ ] **Step 3: 补全 `apps/desktop/package.json`**

在 `scripts` 加 `dist`，加 `config`，把 `build` 换成完整配置（其余字段不变）：

```json
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "node --test --experimental-strip-types test/*.test.ts",
    "dist": "pnpm -w run build && pnpm run build && node scripts/fetch-node.mjs && node scripts/prepare-tah.mjs && electron-builder --mac --arm64"
  },
  "config": {
    "node": "22.23.3"
  },
  "build": {
    "appId": "dev.tah.desktop",
    "directories": {
      "output": "release"
    },
    "files": ["dist/**/*", "package.json"],
    "extraResources": [
      { "from": "bundle/node", "to": "node", "filter": ["**/*"] },
      { "from": "bundle/tah", "to": "tah", "filter": ["**/*"] }
    ],
    "npmRebuild": false,
    "mac": {
      "target": [{ "target": "dmg", "arch": ["arm64"] }],
      "category": "public.app-category.developer-tools",
      "identity": "-",
      "hardenedRuntime": false
    },
    "dmg": {
      "artifactName": "tah-${version}-arm64.${ext}"
    }
  }
```

- [ ] **Step 4: 打包**

Run（需要网络：nodejs.org、GitHub 上的 Electron 发布包）：`pnpm --filter desktop dist`
Expected：依次输出 `node 22.23.3 → bundle/node/bin/node`、`tah 0.33.0 → bundle/tah`，electron-builder 结束；存在 `apps/desktop/release/tah-0.33.0-arm64.dmg` 和 `apps/desktop/release/mac-arm64/tah.app`。

如果 electron-builder 报错，先读报错信息再处理（例如 pnpm 依赖收集问题可试 `"nodeModulesCollector"` 相关选项或报告给用户）；不要改 `packages/*`。

- [ ] **Step 5: 检查 App 包内容**

```bash
cd apps/desktop
APP=release/mac-arm64/tah.app
codesign --verify --deep --strict "$APP" && echo SIGNED_OK
R="$APP/Contents/Resources"
"$R/node/bin/node" --version
"$R/node/bin/node" "$R/tah/dist/cli.js" --version
ls "$R/tah/node_modules" | wc -l
ls "$R/tah/dist/web/index.html"
du -sh "$APP" release/*.dmg
```

Expected：`SIGNED_OK`；`v22.23.3`；`0.33.0`；`node_modules` 有几十个目录（不是 0）；`index.html` 存在；`.app` 约 400MB 以内、`.dmg` 在 150MB 左右（记录实际数字）。

如果 `node_modules` 为 0（electron-builder 过滤掉了），把 `extraResources` 里 tah 那项的 `filter` 改为 `["**/*", "node_modules/**/*"]`，重跑 Step 4–5。

- [ ] **Step 6: 冒烟：临时 HOME 启动、退出（不碰真实 `~/.tah`）**

```bash
cd apps/desktop
H=$(mktemp -d); F=$(mktemp -d); mkdir -p "$H/.tah"
printf '{"lastFolder":"%s"}\n' "$F" > "$H/.tah/desktop.json"
HOME="$H" release/mac-arm64/tah.app/Contents/MacOS/tah > /tmp/tah-app.log 2>&1 &
sleep 10
pgrep -fl "Resources/tah/dist/cli.js serve"
osascript -e 'tell application id "dev.tah.desktop" to quit'
sleep 7
pgrep -fl "Resources/tah/dist/cli.js serve" || echo "NO_TAH_LEFT"
pgrep -fl "tah.app/Contents/MacOS/tah" || echo "NO_APP_LEFT"
cat "$H/.tah/desktop.json"
cat /tmp/tah-app.log
```

Expected：第一个 `pgrep` 列出一个 `.../Resources/node/bin/node .../Resources/tah/dist/cli.js serve --cwd $F --port 0 --no-open` 进程；退出后 `NO_TAH_LEFT`、`NO_APP_LEFT`；`desktop.json` 的 `lastFolder` 等于 `$F`；日志里没有异常堆栈（有 `[tah] stopping…` 之类的正常输出不算）。

- [ ] **Step 7: 确认内核没动，提交**

Run：`git diff --stat HEAD -- packages/ && git status --short`
Expected：`packages/` 无改动；`bundle/`、`release/` 不出现在 status 里（被 `apps/desktop/.gitignore` 忽略）。

按 code-commit 技能提交 `apps/desktop/package.json`、`apps/desktop/scripts/fetch-node.mjs`、`apps/desktop/scripts/prepare-tah.mjs`。参考信息：`build(desktop): 打包 arm64 dmg，内置 Node 22 与 tah`。

---

### Task 6: 手动验收 + 文档

**Files:**
- Modify: `docs/design/desktop.md`（状态行、打包一节的命令写成实际用的）
- Modify: `CHANGELOG.md`（顶部加 `## Unreleased` 一条）

- [ ] **Step 1: 请用户做手动验收**

这些要用真实 `~/.tah` 和真实桌面操作，交给用户。把下面清单发给用户（`apps/desktop/release/tah-0.33.0-arm64.dmg`，拖进「应用程序」后打开；首次被拦就右键「打开」）：

1. 第一次打开弹「选文件夹」，选完进入工作台。（如果之前跑过 App，先删掉 `~/.tah/desktop.json`。）
2. 发一条消息；让 Agent 跑 `git --version`、`which node`，能找到。
3. 关窗口，等一轮跑完，点 Dock 图标，内容还在。
4. 在侧栏换一个文件夹，⌘Q，再打开，回到换过去的那个文件夹。
5. 内置浏览器能打开 Chrome。
6. 终端里 `tah serve` 打开同一个文件夹，能看到客户端里的会话。
7. 活动监视器里退出后没有残留的 `node` 进程。

等用户反馈。有失败项就回到对应任务修（仍不改 `packages/*`）。

- [ ] **Step 2: 更新 `docs/design/desktop.md`**

状态行：

```markdown
状态：✅ 已实现（v0.34）
```

「打包」一节里 tah 那一条改成实际命令：

```markdown
- tah：先 `pnpm -r build`，再用 `pnpm --filter @typescript-agent-harness/cli deploy --prod --legacy --config.node-linker=hoisted` 把 cli 连同依赖装成普通目录，删掉 `node_modules/.bin`（只有软链接），放进 `Resources/tah/`。
```

- [ ] **Step 3: `CHANGELOG.md` 顶部（`# Changelog` 下）加**

```markdown
## Unreleased

Desktop: **macOS app** (`apps/desktop`, Apple Silicon, built locally with `pnpm --filter desktop dist` → `apps/desktop/release/tah-<version>-arm64.dmg`, unsigned). It wraps `tah serve` in a window: double-click to open, reopens the last folder (first launch asks for one), and agent commands get the PATH from your login shell. It ships its own Node 22 and shares `~/.tah` with the command line. Closing the window keeps tah running; ⌘Q stops it. No changes to the published packages.
```

- [ ] **Step 4: 文档构建**

Run：`pnpm docs:build`
Expected：成功，无死链报错。

- [ ] **Step 5: 全量回归**

Run：`pnpm -r build && pnpm test && pnpm --filter desktop test`
Expected：全部 PASS（`pnpm test` 只跑 `packages/**`，desktop 单独跑）。

- [ ] **Step 6: 确认内核没动，提交**

Run：`git diff --stat HEAD -- packages/`
Expected：无输出。

按 code-commit 技能提交 `docs/design/desktop.md`、`CHANGELOG.md`。参考信息：`docs(desktop): 客户端已实现，补更新日志`。
