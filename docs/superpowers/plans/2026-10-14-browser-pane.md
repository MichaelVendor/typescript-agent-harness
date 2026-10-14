# 浏览器面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把内置浏览器（Playwright MCP 驱动的 Chrome）的实时画面放进 `tah serve` 网页右侧面板；用户能看着 Agent 操作，也能在画面里点击、打字接手，或者自己打开网页。

**Architecture:** 全部在 Application 层。`packages/cli/src/browser.ts` 把「启动浏览器」和「给 Agent 挂工具」拆开，并让 Chrome 打开调试端口；`serve/screen.ts` 用 Node 自带的 `WebSocket` 连 Chrome DevTools Protocol（CDP），截屏帧经 SSE（`GET /api/browser/stream`）推给网页，网页的点击、按键经 POST 转成 CDP `Input.*`。`packages/web` 新增 `BrowserPane`，和文件预览共用右侧的 `SidePanel`。

**Tech Stack:** TypeScript（NodeNext、strict、`exactOptionalPropertyTypes`）、`node:http`、Node 22 全局 `WebSocket` / `fetch`、Playwright MCP 0.0.83、React 19、`node --test --experimental-strip-types`。

**Spec:** `docs/design/browser-pane.md`

## Global Constraints

- 只改 `packages/cli/src/{browser,runtime,host,prompt,index}.ts`、`packages/cli/src/serve/*`、`packages/cli/test/**`、`packages/web/**` 和文档；`core` / `agent` / `tools` / `llm` / `mcp` / `permissions` / `storage` / `scheduler` 和 `apps/desktop` 一行不改。`packages/*` 不出现 Electron 代码。不给模型加工具。
- 模型的浏览器工具不变：`browser_open` + 18 个 `BROWSER_TOOLS`。
- 审批：只有 Agent 已接入（`agentAttached()`）时 `browser_open` 才自动放行；用户先在面板里启动的浏览器，Agent 第一次用仍要批准。`browser_file_upload` 每次问。
- Playwright MCP 新参数原文：`--config <home>/.tah/browser-config.json`、`--idle-timeout 0`、`--viewport-size 1280x720`；配置文件内容 `{"browser":{"launchOptions":{"args":["--remote-debugging-port=0"]}}}`。`--headless` 仍是最后一个参数，`tah run` 和 `tah serve` 带，`tah chat` 不带。
- 面板能打开的地址：`http:` / `https:`（主机是 `127.0.0.1`、`localhost`、`[::1]` 且端口等于 `tah serve` 端口的除外）、`about:blank`、以 `/preview/` 开头的路径（服务端补成 `http://127.0.0.1:<端口>/preview/…`）；其他 400。
- 新接口都要登录 cookie；POST 沿用 `Origin` 校验和 `application/json`。用户在面板里的输入不写日志、不进会话、不进事件流。
- 截屏：`Page.startScreencast` `{ format: "jpeg", quality: 70 }`；只在有 `GET /api/browser/stream` 订阅时截；写不进去的订阅者只保留最新一帧。
- 网页只通过 `api.ts` 发请求；面板文字用英文：`Agent is using the browser`、`Enter a URL above to open the browser`、`Open in browser`、`Browser`、`The agent is using this browser. Close it anyway?`。
- 测试用临时目录 / 临时 HOME，不碰真实 `~/.tah`；CI 测试不启动真 Chrome（用 `test/fixtures/fake-browser.mjs` 和 `test/fixtures/fake-cdp.ts`）。cli 测试 import `../dist`，跑之前先 build。
- 提交走 `~/.cursor/skills/code-commit/SKILL.md`；不 push；不 `--no-verify`；不提交 `.superpowers/`。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `packages/cli/src/browser.ts` | `Browser` 类型；`writeBrowserConfig`；`launch` / 挂工具拆开；`cdpPort` 读 `DevToolsActivePort` |
| `packages/cli/src/runtime.ts` | 审批用 `agentAttached()`；`headless` 规则；`bootRuntime` 返回 `browser` |
| `packages/cli/src/host.ts` | `ChatHost.browser` |
| `packages/cli/src/prompt.ts` | 浏览器提示词不再说「窗口」 |
| `packages/cli/src/serve/protocol.ts` | `BrowserState`、`BrowserInput`、`BrowserStreamEvent`、请求体类型 |
| `packages/cli/src/serve/screen.ts`（新） | `connectCdp`、`browserURL`、`parseInput`、`cdpInput`、`createScreen` |
| `packages/cli/src/serve/http.ts` | `/api/browser*` 路由、事件中心触发同步、`connectCdp` 注入 |
| `packages/cli/src/index.ts` | 导出新类型 |
| `packages/cli/test/fixtures/fake-browser.mjs` | 加 `browser_tabs`、写端口文件、`--busy` |
| `packages/cli/test/fixtures/fake-cdp.ts`（新） | 假浏览器、假 CDP 连接 |
| `packages/web/src/browser-view.ts`（新） | 纯函数：链接分流、地址补全、坐标、按键、Agent 是否在用浏览器 |
| `packages/web/src/api.ts` | `browserState` 等 6 个方法和 `browserStream` |
| `packages/web/src/components/SidePanel.tsx`（新） | 右侧面板外壳：宽度、拖动、File / Browser 切换 |
| `packages/web/src/components/BrowserPane.tsx`（新） | 浏览器面板 |
| `packages/web/src/components/FilePreview.tsx` | 外壳交给 `SidePanel`；「Open in browser」 |
| `packages/web/src/components/Messages.tsx` | http(s) 链接在面板打开 |
| `packages/web/src/components/StatusBar.tsx` | 「Browser」按钮 |
| `packages/web/src/components/ApprovalCard.tsx` | `browser_open` 说明 |
| `packages/web/src/App.tsx`、`styles.css` | 面板切换和样式 |
| `docs/design/browser.md`、`serve.md`、`browser-pane.md`、`CHANGELOG.md`、`docs/guide/roadmap.md` | 文档 |

---

### Task 1: `browser.ts`：启动和挂工具拆开，Chrome 打开调试端口

**Files:**
- Modify: `packages/cli/src/browser.ts`
- Modify: `packages/cli/src/runtime.ts`（只改审批那一行）
- Modify: `packages/cli/test/fixtures/fake-browser.mjs`
- Test: `packages/cli/test/browser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Browser = {
    plugin: Plugin;
    agentAttached(): boolean;
    running(): boolean;
    launch(): Promise<void>;
    cdpPort(): number | undefined;
    close(): Promise<void>;
  };
  export function writeBrowserConfig(homeDir: string): void;
  export function createBrowser(o: BrowserOptions): Browser; // 原来返回 { plugin; isOpen() }，isOpen 删掉
  ```
  `playwrightServer(o)` 的参数多 `--config`、`--idle-timeout 0`、`--viewport-size 1280x720`。

- [ ] **Step 1: 改假 Playwright MCP**

`packages/cli/test/fixtures/fake-browser.mjs` 整个替换为：

```js
#!/usr/bin/env node
/** Stands in for Playwright MCP in tests: one JSON-RPC message per line. `--user-data-dir <dir>` gets a DevToolsActivePort once the browser "starts"; `--busy` acts as if another tah holds the profile. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const tool = (name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } });
const TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_tabs",
  "browser_close",
  "browser_run_code_unsafe",
].map(tool);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const profile = arg("--user-data-dir");
const busy = process.argv.includes("--busy");
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const text = (id, t, extra = []) => reply(id, { content: [{ type: "text", text: t }, ...extra] });

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const msg = JSON.parse(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
    if (msg.method === "initialize") {
      reply(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake-browser", version: "0" } });
    } else if (msg.method === "tools/list") {
      reply(msg.id, { tools: TOOLS });
    } else if (msg.method === "tools/call") {
      const { name, arguments: args } = msg.params;
      if (name === "browser_tabs" && busy) {
        reply(msg.id, { content: [{ type: "text", text: "### Error\nError: Browser is already in use for /p, use --isolated to run multiple instances of the same browser" }], isError: true });
      } else if (name === "browser_tabs") {
        if (profile) {
          mkdirSync(profile, { recursive: true });
          writeFileSync(path.join(profile, "DevToolsActivePort"), "9222\n/devtools/browser/fake\n");
        }
        text(msg.id, "### Result\n- 0: (current) [](about:blank)");
      } else if (name === "browser_navigate") text(msg.id, `- Page URL: ${args.url}\n- Page Title: Title of ${args.url}`);
      else if (name === "browser_snapshot") text(msg.id, "x".repeat(40_000));
      else if (name === "browser_take_screenshot") {
        text(msg.id, "saved .tah/browser/page.png", [{ type: "image", data: "AAAA", mimeType: "image/png" }]);
      } else text(msg.id, "closed");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
```

- [ ] **Step 2: 写失败的测试**

`packages/cli/test/browser.test.ts`：

1. import 改为：

```ts
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
```

```ts
import { BROWSER_RESULT_CHARS, createBrowser, playwrightServer, writeBrowserConfig } from "../dist/browser.js";
```

2. `boot` 整个替换为（假服务器拿到 tah 的登录目录，`extra` 追加参数；`command` 不是 node 时不带参数）：

```ts
async function boot(extra: string[] = [], command = process.execPath) {
  const homeDir = dir();
  const profile = path.join(homeDir, ".tah", "browser-profile");
  const server = { command, args: command === process.execPath ? [fake, "--user-data-dir", profile, ...extra] : [] };
  const browser = createBrowser({ cwd: dir(), homeDir, headless: true, server });
  const runtime = new Runtime({ id: "t" });
  runtime.use(toolsPlugin({ tools: [] })).use(browser.plugin);
  await runtime.start();
  const tools = runtime.get(TOOLS);
  let n = 0;
  const call = (name: string, args: unknown = {}) => {
    n += 1;
    const id = `c${n}`;
    return tools.execute(
      { id, name, arguments: args },
      { sessionId: "s", callId: id, signal: new AbortController().signal, runtime: runtime.context() },
    );
  };
  const names = () => tools.listSchemas().map((t) => t.name).sort();
  return { browser, runtime, call, names, profile };
}
```

3. 第一个测试改为：

```ts
test("browser_open mounts the allowed browser tools; a second open reuses the browser", async () => {
  const { browser, runtime, call, names } = await boot();
  assert.deepEqual(names(), ["browser_open"]);
  assert.equal(browser.running(), false);
  const first = await call("browser_open", { url: "https://example.com" });
  assert.equal(first.ok, true);
  assert.equal((first.output as { opened: boolean }).opened, true);
  assert.match(String((first.output as { page: string }).page), /Title of https:\/\/example.com/);
  assert.deepEqual(names(), [
    "browser_close",
    "browser_navigate",
    "browser_open",
    "browser_snapshot",
    "browser_tabs",
    "browser_take_screenshot",
  ]);
  assert.equal(browser.running(), true);
  assert.equal(browser.agentAttached(), true);
  const again = await call("browser_open");
  assert.equal((again.output as { opened: boolean }).opened, false);
  assert.equal((again.output as { page: string }).page, "");
  await runtime.stop();
  assert.equal(browser.running(), false);
  assert.equal(browser.agentAttached(), false);
});
```

4. `browser_close withdraws…` 里两处 `browser.isOpen()` 改成 `browser.running()`。

5. `a browser that cannot start…` 改为：

```ts
test("a browser that cannot start fails browser_open and mounts nothing", async () => {
  const { browser, runtime, call, names } = await boot([], "/nonexistent/playwright-mcp");
  const out = await call("browser_open");
  assert.equal(out.ok, false);
  assert.match(String((out.output as { error: string }).error), /could not start the browser/);
  assert.deepEqual(names(), ["browser_open"]);
  assert.equal(browser.running(), false);
  await runtime.stop();
});
```

6. `a profile held by another tah…` 改为：

```ts
test("a profile held by another tah closes the browser again with a clear error", async () => {
  const { browser, runtime, call, names } = await boot(["--busy"]);
  try {
    const out = await call("browser_open", { url: "https://example.com" });
    assert.equal(out.ok, false);
    assert.match(String((out.output as { error: string }).error), /browser-profile is in use by another tah/);
    assert.deepEqual(names(), ["browser_open"]);
    assert.equal(browser.running(), false);
    await assert.rejects(browser.launch(), /browser-profile is in use by another tah/);
  } finally {
    await runtime.stop();
  }
});
```

7. `playwrightServer…` 测试的期望参数改为：

```ts
  assert.deepEqual(s.args.slice(1), [
    "--browser",
    "chrome",
    "--user-data-dir",
    path.join("/h", ".tah", "browser-profile"),
    "--output-dir",
    path.join("/w", ".tah", "browser"),
    "--image-responses",
    "omit",
    "--config",
    path.join("/h", ".tah", "browser-config.json"),
    "--idle-timeout",
    "0",
    "--viewport-size",
    "1280x720",
  ]);
```

8. 测试名 `bootRuntime mounts browser_open (not with --mock); approval is asked only while the browser is closed` 改成 `bootRuntime mounts browser_open (not with --mock); approval is asked until the agent's browser is attached`，内容不变。

9. 在 `playwrightServer…` 测试之前加两个测试：

```ts
test("launch() starts the browser for the panel without giving the agent tools; browser_open then mounts them", async () => {
  const { browser, runtime, call, names, profile } = await boot();
  mkdirSync(profile, { recursive: true });
  writeFileSync(path.join(profile, "DevToolsActivePort"), "1111\n/devtools/browser/stale\n");
  assert.equal(browser.cdpPort(), undefined);
  await Promise.all([browser.launch(), browser.launch()]);
  assert.equal(browser.running(), true);
  assert.equal(browser.agentAttached(), false);
  assert.deepEqual(names(), ["browser_open"]);
  assert.equal(browser.cdpPort(), 9222);
  const out = await call("browser_open");
  assert.equal((out.output as { opened: boolean }).opened, false);
  assert.equal(browser.agentAttached(), true);
  assert.ok(names().includes("browser_snapshot"));
  await browser.close();
  assert.equal(browser.running(), false);
  assert.equal(browser.agentAttached(), false);
  assert.equal(browser.cdpPort(), undefined);
  assert.deepEqual(names(), ["browser_open"]);
  await runtime.stop();
});

test("writeBrowserConfig makes Chrome open a random debugging port", () => {
  const home = dir();
  writeBrowserConfig(home);
  assert.deepEqual(JSON.parse(readFileSync(path.join(home, ".tah", "browser-config.json"), "utf8")), {
    browser: { launchOptions: { args: ["--remote-debugging-port=0"] } },
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/browser.test.ts`
Expected：FAIL（`writeBrowserConfig` 不是导出的函数；`browser.running` 不是函数）。

- [ ] **Step 4: 实现**

`packages/cli/src/browser.ts`：

1. 第一行 import 改为 `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";`；mcp 那行改为 `import { mcpResultText, stdioMcpBackend, type McpBackend, type McpToolInfo } from "@typescript-agent-harness/mcp";`。

2. `BrowserOptions` 里 `headless` 的注释改为：

```ts
  /** `tah chat` shows a Chrome window; `tah run` has nobody watching and `tah serve` shows the page in its browser panel. */
  headless: boolean;
```

3. `BrowserOptions` 之后、`playwrightServer` 之前加：

```ts
/** One tah host's browser: the agent's tools, plus what `tah serve`'s browser panel needs. */
export type Browser = {
  plugin: Plugin;
  /** The agent's `browser_open` was approved and the browser tools are mounted. */
  agentAttached(): boolean;
  /** Playwright MCP is running. */
  running(): boolean;
  /** Starts the browser for the panel; mounts no tools. */
  launch(): Promise<void>;
  /** Chrome's debugging port; undefined while the browser is not running. */
  cdpPort(): number | undefined;
  /** Closes the browser and withdraws the tools. */
  close(): Promise<void>;
};

const profileDir = (homeDir: string) => path.join(homeDir, ".tah", "browser-profile");
const configFile = (homeDir: string) => path.join(homeDir, ".tah", "browser-config.json");

/** Playwright MCP's config: Chrome opens a random debugging port and writes it to `<profile>/DevToolsActivePort`. */
export function writeBrowserConfig(homeDir: string): void {
  mkdirSync(path.dirname(configFile(homeDir)), { recursive: true });
  writeFileSync(configFile(homeDir), `${JSON.stringify({ browser: { launchOptions: { args: ["--remote-debugging-port=0"] } } })}\n`);
}
```

4. `playwrightServer` 的 `args` 改为：

```ts
    args: [
      path.join(path.dirname(pkg), bin),
      "--browser",
      "chrome",
      "--user-data-dir",
      profileDir(o.homeDir),
      "--output-dir",
      path.join(o.cwd, ".tah", "browser"),
      "--image-responses",
      "omit",
      "--config",
      configFile(o.homeDir),
      "--idle-timeout",
      "0",
      "--viewport-size",
      "1280x720",
      ...(o.headless ? ["--headless"] : []),
    ],
```

5. 从 `/** \`browser_open\` starts Playwright MCP…` 那行注释到文件末尾，整个替换为：

```ts
/** `browser_open` starts Playwright MCP on first use and mounts the browser tools; `browser_close` takes them down again. The panel can start the browser first (`launch`) without mounting them. */
export function createBrowser(o: BrowserOptions): Browser {
  let tools: ToolService | undefined;
  let backend: McpBackend | undefined;
  let starting: Promise<McpBackend> | undefined;
  let infos: McpToolInfo[] = [];
  let mounted: string[] = [];

  async function shut() {
    for (const name of mounted) tools?.unregister(name);
    mounted = [];
    const b = backend;
    backend = undefined;
    await b?.close?.();
  }

  /** Playwright MCP starts Chrome on its first tool call; `browser_tabs` makes that happen now. */
  async function start(): Promise<McpBackend> {
    if (!o.server) writeBrowserConfig(o.homeDir);
    const b = stdioMcpBackend({ ...(o.server ?? playwrightServer(o)), cwd: o.cwd });
    try {
      infos = (await b.listTools()).filter((t) => BROWSER_TOOLS.includes(t.name));
      mcpResultText(await b.callTool("browser_tabs", { action: "list" }));
    } catch (err) {
      await b.close?.();
      const message = err instanceof Error ? err.message : String(err);
      if (/already in use/i.test(message)) {
        throw new Error(
          `the browser profile ${profileDir(o.homeDir)} is in use by another tah — close that tah (or its browser) and try again`,
        );
      }
      throw new Error(`could not start the browser: ${message}`);
    }
    backend = b;
    return b;
  }

  const ensure = (): Promise<McpBackend> =>
    backend ? Promise.resolve(backend) : (starting ??= start().finally(() => (starting = undefined)));

  function mount(b: McpBackend) {
    for (const info of infos) {
      tools!.register({
        name: info.name,
        description: info.description,
        inputSchema: info.inputSchema,
        async execute(input) {
          const out = clipResult(mcpResultText(await b.callTool(info.name, input)));
          if (info.name === "browser_close") await shut();
          return out;
        },
      });
      mounted.push(info.name);
    }
  }

  const openTool: Tool = {
    name: "browser_open",
    description:
      "Open a Chrome browser the user can watch (or reuse the open one) and go to `url` if given. Afterwards the browser_* tools (navigate, snapshot, click, type, fill_form, …) are available. Use it for clicking, forms, logins, or pages rendered by JavaScript; use web_fetch to just read a page.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Page to open; omit to stay on the current page" } },
      additionalProperties: false,
    },
    async execute(input) {
      const wasRunning = backend !== undefined;
      const b = await ensure();
      if (mounted.length === 0) mount(b);
      const url = (input as { url?: unknown } | undefined)?.url;
      const page = typeof url === "string" && url ? mcpResultText(await b.callTool("browser_navigate", { url })) : "";
      return { opened: !wasRunning, tools: [...mounted], page: clipResult(page) };
    },
  };

  return {
    plugin: {
      name: "browser",
      setup(ctx) {
        tools = ctx.get(TOOLS);
        tools.register(openTool);
      },
      async dispose() {
        await shut();
      },
    },
    agentAttached: () => mounted.length > 0,
    running: () => backend !== undefined,
    async launch() {
      await ensure();
    },
    cdpPort() {
      if (!backend) return undefined;
      try {
        const port = Number(readFileSync(path.join(profileDir(o.homeDir), "DevToolsActivePort"), "utf8").split("\n")[0]);
        return Number.isInteger(port) && port > 0 ? port : undefined;
      } catch {
        return undefined;
      }
    },
    async close() {
      await starting?.catch(() => {});
      await shut();
    },
  };
}
```

`packages/cli/src/runtime.ts` 审批那一行改为：

```ts
          if (call.name === "browser_open" && browser?.agentAttached()) return Promise.resolve("yes" as const);
```

- [ ] **Step 5: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/browser.test.ts`
Expected：PASS。

- [ ] **Step 6: 提交**

按 code-commit 技能提交 `packages/cli/src/browser.ts`、`packages/cli/src/runtime.ts`、`packages/cli/test/browser.test.ts`、`packages/cli/test/fixtures/fake-browser.mjs`。参考信息：`feat(cli): 浏览器可先启动再给 Agent 挂工具，Chrome 打开调试端口`。

---

### Task 2: runtime / host 接上浏览器，`tah serve` 不再弹窗口

**Files:**
- Modify: `packages/cli/src/runtime.ts`
- Modify: `packages/cli/src/host.ts`
- Modify: `packages/cli/src/prompt.ts`
- Test: `packages/cli/test/browser.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Browser`。
- Produces: `bootRuntime(...)` 的返回值多 `browser: Browser | undefined`；`ChatHost` 多 `readonly browser: Browser | undefined`（getter，热更新后是新的浏览器）。

- [ ] **Step 1: 写失败的测试**

`packages/cli/test/browser.test.ts` 末尾追加：

```ts
test("bootRuntime: a browser the user launched still needs approval the first time the agent opens it", async () => {
  const cwd = dir();
  const homeDir = dir();
  const prev = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-test";
  const asked: string[] = [];
  try {
    const live = await bootRuntime({ ...parseArgv(["--no-persist", "--quiet", "serve"]), cwd }, {
      homeDir,
      browserServer: { command: process.execPath, args: [fake] },
      ask: async (c) => {
        asked.push(c.name);
        return "yes";
      },
    });
    assert.ok(live.browser);
    await live.browser.launch();
    assert.equal(live.browser.agentAttached(), false);
    const tools = live.runtime.get(TOOLS);
    const ctx = (id: string) => ({ sessionId: "s", callId: id, signal: new AbortController().signal, runtime: live.runtime.context() });
    await tools.execute({ id: "a", name: "browser_open", arguments: {} }, ctx("a"));
    await tools.execute({ id: "b", name: "browser_open", arguments: {} }, ctx("b"));
    assert.deepEqual(asked, ["browser_open"]);
    assert.equal(live.browser.agentAttached(), true);
    await live.runtime.stop();

    const mock = await bootRuntime({ ...parseArgv(["--mock", "--no-persist", "--quiet", "serve"]), cwd }, { homeDir });
    assert.equal(mock.browser, undefined);
    await mock.runtime.stop();
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/browser.test.ts`
Expected：FAIL（`live.browser` 是 undefined）。

- [ ] **Step 3: 实现**

`packages/cli/src/runtime.ts`：

1. import 改为 `import { createBrowser, type Browser, type BrowserServer } from "./browser.js";`
2. `bootRuntime` 返回类型里 `ocr: boolean;` 之后加：

```ts
  /** The built-in browser; undefined when it is off (`capabilities.browser`, `--mock`). */
  browser: Browser | undefined;
```

3. `headless: flags.command === "run",` 改为 `headless: flags.command !== "chat",`
4. 末尾 `return { … ocr, };` 里 `ocr,` 之后加 `browser,`。

`packages/cli/src/host.ts`：

1. import 加 `import type { Browser } from "./browser.js";`（放在 `./attachments/store.js` 那组之后）。
2. `ChatHost` 里 `readonly approve: boolean;` 之后加：

```ts
  /** The open folder's built-in browser (undefined when it is off); a reload replaces it. */
  readonly browser: Browser | undefined;
```

3. `let images: ImageAccess = "none";` 之后加 `let browser: Browser | undefined;`；`boot` 里 `images = …;` 之后加 `browser = booted.browser;`。
4. `const host: ChatHost = {` 里 `approve: !flags.yes,` 之后加：

```ts
    get browser() {
      return browser;
    },
```

`packages/cli/src/prompt.ts` 的 `BROWSER_RULES` 改为：

```ts
const BROWSER_RULES =
  "For pages that need clicking, forms, logins, or JavaScript rendering, call browser_open first: it opens a Chrome browser the user can watch and adds browser_* tools. Understand pages with browser_snapshot or browser_find; screenshots are only saved for the user. For logins, captchas, payments, or anything that needs the user's confirmation, stop and ask the user to finish it in that browser.";
```

- [ ] **Step 4: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/browser.test.ts test/host.test.ts test/prompt-exec.test.ts test/serve.test.ts`
Expected：PASS。

- [ ] **Step 5: 提交**

按 code-commit 技能提交 `packages/cli/src/runtime.ts`、`packages/cli/src/host.ts`、`packages/cli/src/prompt.ts`、`packages/cli/test/browser.test.ts`。参考信息：`feat(cli): host 暴露当前文件夹的浏览器，tah serve 改为无界面`。

---

### Task 3: `serve/screen.ts`：CDP 连接、截屏、输入、地址检查

**Files:**
- Modify: `packages/cli/src/serve/protocol.ts`
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/serve/screen.ts`
- Create: `packages/cli/test/fixtures/fake-cdp.ts`
- Test: `packages/cli/test/screen.test.ts`（新）

**Interfaces:**
- Consumes: Task 1 的 `Browser`。
- Produces（`protocol.ts`）：

  ```ts
  export type BrowserState = { available: boolean; running: boolean; agent: boolean; tabs: { id: string; title: string; url: string }[]; active: string | null; error?: string };
  export type BrowserInput =
    | { type: "mouse"; event: "move" | "down" | "up"; x: number; y: number; button: "left" | "middle" | "right" | "none"; clickCount: number; modifiers: number }
    | { type: "wheel"; x: number; y: number; dx: number; dy: number; modifiers: number }
    | { type: "key"; event: "down" | "up"; key: string; code: string; keyCode: number; modifiers: number; text?: string }
    | { type: "text"; text: string };
  export type BrowserStreamEvent = { type: "state"; state: BrowserState } | { type: "frame"; data: string; width: number; height: number };
  // ServeRequest 加：browserOpen: { url?: string }; browserNav: { action: "back" | "reload" }; browserTab: { id: string };
  ```

- Produces（`screen.ts`）：

  ```ts
  export type Cdp = { send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>; on(listener: (method: string, params: Record<string, unknown>, sessionId: string | undefined) => void): void; onClose(listener: () => void): void; close(): void };
  export function connectCdp(port: number): Promise<Cdp>;
  export function browserURL(input: string, port: number): string | undefined;
  export function parseInput(body: Record<string, unknown>): BrowserInput;
  export function cdpInput(input: BrowserInput): [string, Record<string, unknown>];
  export type Screen = { state(): BrowserState; subscribe(listener: (event: BrowserStreamEvent) => void): () => void; sync(): Promise<void>; open(url?: string): Promise<void>; nav(action: "back" | "reload"): Promise<void>; tab(id: string): Promise<void>; input(input: BrowserInput): Promise<void>; close(): Promise<void>; dispose(): void };
  export function createScreen(opts: { browser(): Browser | undefined; connect?: (port: number) => Promise<Cdp> }): Screen;
  ```

- [ ] **Step 1: 协议类型**

`packages/cli/src/serve/protocol.ts`：

`ServeRequest` 里 `choose: { start?: string };` 之后加：

```ts
  /** `url`: http(s) (not tah itself), `about:blank`, or a `/preview/…` address; omitted = just start the browser. */
  browserOpen: { url?: string };
  browserNav: { action: "back" | "reload" };
  browserTab: { id: string };
```

文件末尾加：

```ts
/** `GET /api/browser` and the `state` events of `GET /api/browser/stream`. */
export type BrowserState = {
  /** The open folder has the built-in browser (`capabilities.browser`, not `--mock`). */
  available: boolean;
  /** Playwright MCP is running. */
  running: boolean;
  /** The agent's `browser_open` was approved; its browser tools are mounted. */
  agent: boolean;
  tabs: { id: string; title: string; url: string }[];
  /** The tab the panel shows. */
  active: string | null;
  /** Why the browser last failed to start. */
  error?: string;
};

/** `POST /api/browser/input`: coordinates in page CSS pixels; `modifiers` bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export type BrowserInput =
  | {
      type: "mouse";
      event: "move" | "down" | "up";
      x: number;
      y: number;
      button: "left" | "middle" | "right" | "none";
      clickCount: number;
      modifiers: number;
    }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number; modifiers: number }
  | { type: "key"; event: "down" | "up"; key: string; code: string; keyCode: number; modifiers: number; text?: string }
  | { type: "text"; text: string };

/** One event of `GET /api/browser/stream`; a frame's `data` is a base64 JPEG, `width` / `height` the page size in CSS pixels. */
export type BrowserStreamEvent =
  | { type: "state"; state: BrowserState }
  | { type: "frame"; data: string; width: number; height: number };
```

`packages/cli/src/index.ts` 的 `./serve/protocol.js` 导出列表按字母序加 `BrowserInput`、`BrowserState`、`BrowserStreamEvent`（放在 `DirListing` 之前）。

- [ ] **Step 2: 测试替身**

新建 `packages/cli/test/fixtures/fake-cdp.ts`：

```ts
/** Stand-ins for the browser panel: a browser whose debugging port is 9222, and a CDP connection that records commands. */
export type Sent = { method: string; params: Record<string, unknown>; sessionId?: string };
type Listener = (method: string, params: Record<string, unknown>, sessionId: string | undefined) => void;

export function fakeBrowser(opts: { failLaunch?: string } = {}) {
  let running = false;
  let launches = 0;
  let closes = 0;
  const browser = {
    plugin: { name: "browser" },
    agentAttached: () => false,
    running: () => running,
    async launch() {
      launches += 1;
      if (opts.failLaunch) throw new Error(opts.failLaunch);
      running = true;
    },
    cdpPort: () => (running ? 9222 : undefined),
    async close() {
      closes += 1;
      running = false;
    },
  };
  return { browser, launches: () => launches, closes: () => closes, crash: () => void (running = false) };
}

/** Starts with one page tab `T1`; attaching to tab X gives session `S-X`. */
export function fakeCdp() {
  const sent: Sent[] = [];
  let listener: Listener = () => {};
  let closer = () => {};
  let closed = false;
  const cdp = {
    async send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      sent.push(sessionId ? { method, params, sessionId } : { method, params });
      if (method === "Target.getTargets") {
        return { targetInfos: [{ targetId: "T1", type: "page", title: "Blank", url: "about:blank" }] };
      }
      if (method === "Target.attachToTarget") return { sessionId: `S-${String(params.targetId)}` };
      if (method === "Page.getNavigationHistory") return { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }] };
      return {};
    },
    on(l: Listener) {
      listener = l;
    },
    onClose(l: () => void) {
      closer = l;
    },
    close() {
      if (closed) return;
      closed = true;
      closer();
    },
  };
  return {
    cdp,
    sent,
    event: (method: string, params: Record<string, unknown>, sessionId?: string) => listener(method, params, sessionId),
    closed: () => closed,
  };
}

/** Lets pending promise chains settle. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));
```

- [ ] **Step 3: 写失败的测试**

新建 `packages/cli/test/screen.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserURL, cdpInput, createScreen, parseInput } from "../dist/serve/screen.js";
import { fakeBrowser, fakeCdp, tick } from "./fixtures/fake-cdp.ts";

test("browserURL: web pages, a blank page and file previews; never tah itself", () => {
  assert.equal(browserURL("https://example.com/a", 7000), "https://example.com/a");
  assert.equal(browserURL(" http://localhost:3000/ ", 7000), "http://localhost:3000/");
  assert.equal(browserURL("about:blank", 7000), "about:blank");
  assert.equal(browserURL("/preview/tok/a%20b.html", 7000), "http://127.0.0.1:7000/preview/tok/a%20b.html");
  for (const bad of [
    "http://127.0.0.1:7000/",
    "http://localhost:7000/api/events",
    "http://[::1]:7000/",
    "http://2130706433:7000/",
    "/api/events",
    "/preview/../api/events",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "example.com",
    "",
  ]) {
    assert.equal(browserURL(bad, 7000), undefined, bad);
  }
  assert.equal(browserURL("http://127.0.0.1/", 80), undefined);
});

test("parseInput keeps valid input and rejects anything else", () => {
  const mouse = { type: "mouse", event: "down", x: 1, y: 2.5, button: "left", clickCount: 1, modifiers: 0 };
  const wheel = { type: "wheel", x: 1, y: 2, dx: 0, dy: 120, modifiers: 8 };
  const key = { type: "key", event: "down", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0, text: "\r" };
  assert.deepEqual(parseInput(mouse), mouse);
  assert.deepEqual(parseInput({ ...mouse, extra: 1 }), mouse);
  assert.deepEqual(parseInput(wheel), wheel);
  assert.deepEqual(parseInput(key), key);
  const { text: _text, ...plainKey } = key;
  assert.deepEqual(parseInput(plainKey), plainKey);
  assert.deepEqual(parseInput({ type: "text", text: "你好" }), { type: "text", text: "你好" });
  for (const bad of [
    { type: "mouse" },
    { ...mouse, event: "click" },
    { ...mouse, x: "1" },
    { ...mouse, button: "back" },
    { ...wheel, dy: Infinity },
    { ...key, text: 1 },
    { type: "text" },
    { type: "touch" },
    {},
  ]) {
    assert.throws(() => parseInput(bad), Error, JSON.stringify(bad));
  }
});

test("cdpInput maps input to CDP commands", () => {
  assert.deepEqual(cdpInput({ type: "mouse", event: "down", x: 1, y: 2, button: "left", clickCount: 2, modifiers: 8 }), [
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: 1, y: 2, button: "left", clickCount: 2, modifiers: 8 },
  ]);
  assert.equal(cdpInput({ type: "mouse", event: "move", x: 1, y: 2, button: "none", clickCount: 0, modifiers: 0 })[1].type, "mouseMoved");
  assert.equal(cdpInput({ type: "mouse", event: "up", x: 1, y: 2, button: "left", clickCount: 1, modifiers: 0 })[1].type, "mouseReleased");
  assert.deepEqual(cdpInput({ type: "wheel", x: 1, y: 2, dx: 0, dy: 100, modifiers: 0 }), [
    "Input.dispatchMouseEvent",
    { type: "mouseWheel", x: 1, y: 2, deltaX: 0, deltaY: 100, modifiers: 0 },
  ]);
  assert.deepEqual(cdpInput({ type: "key", event: "down", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0, text: "\r" }), [
    "Input.dispatchKeyEvent",
    { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0, text: "\r" },
  ]);
  assert.equal(cdpInput({ type: "key", event: "down", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, modifiers: 0 })[1].type, "rawKeyDown");
  assert.equal(cdpInput({ type: "key", event: "up", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0 })[1].type, "keyUp");
  assert.deepEqual(cdpInput({ type: "key", event: "down", key: "a", code: "KeyA", keyCode: 65, modifiers: 4 })[1].commands, ["selectAll"]);
  assert.deepEqual(cdpInput({ type: "text", text: "你好" }), ["Input.insertText", { text: "你好" }]);
});

test("open launches the browser, attaches to its newest tab and navigates it", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const ports: number[] = [];
  const screen = createScreen({
    browser: () => fb.browser,
    connect: async (port) => {
      ports.push(port);
      return fc.cdp;
    },
  });
  assert.deepEqual(screen.state(), { available: true, running: false, agent: false, tabs: [], active: null });
  await screen.open("https://example.com/");
  assert.equal(fb.launches(), 1);
  assert.deepEqual(ports, [9222]);
  assert.deepEqual(fc.sent.map((m) => m.method), [
    "Target.setDiscoverTargets",
    "Target.getTargets",
    "Target.attachToTarget",
    "Target.activateTarget",
    "Page.enable",
    "Page.navigate",
  ]);
  assert.deepEqual(fc.sent.at(-1), { method: "Page.navigate", params: { url: "https://example.com/" }, sessionId: "S-T1" });
  assert.deepEqual(screen.state(), {
    available: true,
    running: true,
    agent: false,
    tabs: [{ id: "T1", title: "Blank", url: "about:blank" }],
    active: "T1",
  });
  await screen.open();
  assert.deepEqual(ports, [9222]);
  screen.dispose();
});

test("frames: screencast only while someone watches; a late watcher gets the last frame", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  assert.equal(fc.sent.some((m) => m.method === "Page.startScreencast"), false);
  const a: Array<{ type: string; data?: string }> = [];
  const offA = screen.subscribe((e) => a.push(e));
  await tick();
  assert.equal(a[0]?.type, "state");
  assert.deepEqual(fc.sent.at(-1), { method: "Page.startScreencast", params: { format: "jpeg", quality: 70 }, sessionId: "S-T1" });
  fc.event("Page.screencastFrame", { data: "AAAA", sessionId: 7, metadata: { deviceWidth: 1280, deviceHeight: 720 } }, "S-T1");
  fc.event("Page.screencastFrame", { data: "ZZZZ", sessionId: 8, metadata: { deviceWidth: 1280, deviceHeight: 720 } }, "S-OTHER");
  await tick();
  assert.deepEqual(a.at(-1), { type: "frame", data: "AAAA", width: 1280, height: 720 });
  assert.ok(fc.sent.some((m) => m.method === "Page.screencastFrameAck" && m.params.sessionId === 7 && m.sessionId === "S-T1"));
  const b: Array<{ type: string; data?: string }> = [];
  const offB = screen.subscribe((e) => b.push(e));
  assert.deepEqual(b.map((e) => e.type), ["state", "frame"]);
  assert.equal(b[1]?.data, "AAAA");
  offA();
  offB();
  await tick();
  assert.deepEqual(fc.sent.at(-1), { method: "Page.stopScreencast", params: {}, sessionId: "S-T1" });
  screen.dispose();
});

test("a new tab takes over the panel; closing it goes back to the remaining one", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  fc.event("Target.targetCreated", { targetInfo: { targetId: "T2", type: "page", title: "Login", url: "https://id.example/" } });
  fc.event("Target.targetCreated", { targetInfo: { targetId: "W1", type: "service_worker", title: "", url: "" } });
  await tick();
  assert.equal(screen.state().active, "T2");
  assert.ok(fc.sent.some((m) => m.method === "Target.detachFromTarget" && m.params.sessionId === "S-T1"));
  fc.event("Target.targetInfoChanged", { targetInfo: { targetId: "T2", type: "page", title: "Signed in", url: "https://id.example/done" } });
  assert.deepEqual(screen.state().tabs.map((t) => t.title), ["Blank", "Signed in"]);
  await screen.input({ type: "text", text: "x" });
  assert.equal(fc.sent.at(-1)?.sessionId, "S-T2");
  fc.event("Target.targetDestroyed", { targetId: "T2" });
  await tick();
  assert.equal(screen.state().active, "T1");
  await assert.rejects(screen.tab("T2"), /no tab "T2"/);
  await screen.tab("T1");
  screen.dispose();
});

test("a lost connection is reported; sync reconnects while someone watches", async () => {
  const fb = fakeBrowser();
  const conns = [fakeCdp(), fakeCdp()];
  let n = 0;
  const screen = createScreen({ browser: () => fb.browser, connect: async () => conns[n++]!.cdp });
  await screen.open();
  const events: Array<{ type: string }> = [];
  screen.subscribe((e) => events.push(e));
  const before = events.length;
  conns[0]!.cdp.close();
  assert.deepEqual(screen.state(), { available: true, running: true, agent: false, tabs: [], active: null });
  assert.ok(events.length > before);
  await screen.sync();
  assert.equal(n, 2);
  assert.equal(screen.state().active, "T1");
  screen.dispose();
});

test("sync drops the connection when the browser stops or the folder's browser changes", async () => {
  const first = fakeBrowser();
  let current = first.browser;
  const conns = [fakeCdp(), fakeCdp()];
  let n = 0;
  const screen = createScreen({ browser: () => current, connect: async () => conns[n++]!.cdp });
  await screen.open();
  first.crash();
  await screen.sync();
  assert.equal(conns[0]!.closed(), true);
  assert.deepEqual(screen.state(), { available: true, running: false, agent: false, tabs: [], active: null });
  await screen.open();
  current = fakeBrowser().browser;
  await screen.sync();
  assert.equal(conns[1]!.closed(), true);
  screen.dispose();
});

test("open reports a browser that cannot start; a folder without the browser says so", async () => {
  const fb = fakeBrowser({ failLaunch: "could not start the browser: no Chrome" });
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fakeCdp().cdp });
  await assert.rejects(screen.open(), /no Chrome/);
  assert.equal(screen.state().error, "could not start the browser: no Chrome");

  const off = createScreen({ browser: () => undefined });
  assert.deepEqual(off.state(), { available: false, running: false, agent: false, tabs: [], active: null });
  await assert.rejects(off.open(), /the built-in browser is off in this folder/);
  await assert.rejects(off.input({ type: "text", text: "x" }), /the browser is not open/);
});

test("input, back, reload and close go to the shown tab", async () => {
  const fb = fakeBrowser();
  const fc = fakeCdp();
  const screen = createScreen({ browser: () => fb.browser, connect: async () => fc.cdp });
  await screen.open();
  await screen.input({ type: "text", text: "你好" });
  assert.deepEqual(fc.sent.at(-1), { method: "Input.insertText", params: { text: "你好" }, sessionId: "S-T1" });
  await screen.nav("back");
  assert.deepEqual(fc.sent.at(-1), { method: "Page.navigateToHistoryEntry", params: { entryId: 10 }, sessionId: "S-T1" });
  await screen.nav("reload");
  assert.deepEqual(fc.sent.at(-1), { method: "Page.reload", params: {}, sessionId: "S-T1" });
  await screen.close();
  assert.equal(fb.closes(), 1);
  assert.equal(fc.closed(), true);
  assert.equal(screen.state().running, false);
});
```

- [ ] **Step 4: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/screen.test.ts`
Expected：FAIL（`../dist/serve/screen.js` 不存在）。

- [ ] **Step 5: 实现**

新建 `packages/cli/src/serve/screen.ts`：

```ts
import type { Browser } from "../browser.js";
import type { BrowserInput, BrowserState, BrowserStreamEvent } from "./protocol.js";

type Params = Record<string, unknown>;
type Tab = BrowserState["tabs"][number];
type TargetInfo = { targetId: string; type: string; title: string; url: string };
type Frame = Extract<BrowserStreamEvent, { type: "frame" }>;

/** A Chrome DevTools Protocol connection to the whole browser; `sessionId` addresses an attached tab. */
export type Cdp = {
  send(method: string, params?: Params, sessionId?: string): Promise<Params>;
  on(listener: (method: string, params: Params, sessionId: string | undefined) => void): void;
  onClose(listener: () => void): void;
  close(): void;
};

/** Connects to the browser-level endpoint Chrome lists at `/json/version`. */
export async function connectCdp(port: number): Promise<Cdp> {
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error(`could not connect to the browser on port ${port}`)), { once: true });
  });
  let id = 0;
  const pending = new Map<number, { resolve(result: Params): void; reject(err: Error): void }>();
  const listeners: Array<(method: string, params: Params, sessionId: string | undefined) => void> = [];
  const closers: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: Params;
      result?: Params;
      error?: { message: string };
      sessionId?: string;
    };
    if (msg.id !== undefined) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) waiter?.reject(new Error(msg.error.message));
      else waiter?.resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const listener of listeners) listener(msg.method, msg.params ?? {}, msg.sessionId);
    }
  });
  ws.addEventListener("close", () => {
    for (const waiter of pending.values()) waiter.reject(new Error("the browser connection closed"));
    pending.clear();
    for (const closer of closers) closer();
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        id += 1;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    on: (listener) => void listeners.push(listener),
    onClose: (listener) => void closers.push(listener),
    close: () => ws.close(),
  };
}

const SELF = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** What the panel may open: web pages other than tah itself (`port`), a blank page, or one of this server's file previews. */
export function browserURL(input: string, port: number): string | undefined {
  const text = input.trim();
  if (text === "about:blank") return text;
  if (text.startsWith("/")) {
    const url = new URL(text, `http://127.0.0.1:${port}`);
    return url.pathname.startsWith("/preview/") ? url.href : undefined;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const urlPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (SELF.has(url.hostname) && urlPort === port) return undefined;
  return url.href;
}

const num = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`"${name}" must be a number`);
  return value;
};
const str = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw new Error(`"${name}" must be a string`);
  return value;
};
const oneOf = <T extends string>(value: unknown, name: string, values: readonly T[]): T => {
  if (!values.includes(value as T)) throw new Error(`"${name}" must be one of ${values.join(", ")}`);
  return value as T;
};

/** Checks a `POST /api/browser/input` body; unknown fields are dropped. */
export function parseInput(body: Record<string, unknown>): BrowserInput {
  switch (body.type) {
    case "mouse":
      return {
        type: "mouse",
        event: oneOf(body.event, "event", ["move", "down", "up"] as const),
        x: num(body.x, "x"),
        y: num(body.y, "y"),
        button: oneOf(body.button, "button", ["left", "middle", "right", "none"] as const),
        clickCount: num(body.clickCount, "clickCount"),
        modifiers: num(body.modifiers, "modifiers"),
      };
    case "wheel":
      return {
        type: "wheel",
        x: num(body.x, "x"),
        y: num(body.y, "y"),
        dx: num(body.dx, "dx"),
        dy: num(body.dy, "dy"),
        modifiers: num(body.modifiers, "modifiers"),
      };
    case "key": {
      const key = {
        type: "key" as const,
        event: oneOf(body.event, "event", ["down", "up"] as const),
        key: str(body.key, "key"),
        code: str(body.code, "code"),
        keyCode: num(body.keyCode, "keyCode"),
        modifiers: num(body.modifiers, "modifiers"),
      };
      return body.text === undefined ? key : { ...key, text: str(body.text, "text") };
    }
    case "text":
      return { type: "text", text: str(body.text, "text") };
  }
  throw new Error('"type" must be one of mouse, wheel, key, text');
}

const MOUSE = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" } as const;

/** The CDP command for one input. */
export function cdpInput(input: BrowserInput): [string, Params] {
  switch (input.type) {
    case "mouse": {
      const { x, y, button, clickCount, modifiers } = input;
      return ["Input.dispatchMouseEvent", { type: MOUSE[input.event], x, y, button, clickCount, modifiers }];
    }
    case "wheel":
      return [
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", x: input.x, y: input.y, deltaX: input.dx, deltaY: input.dy, modifiers: input.modifiers },
      ];
    case "key": {
      const params: Params = {
        type: input.event === "up" ? "keyUp" : input.text ? "keyDown" : "rawKeyDown",
        key: input.key,
        code: input.code,
        windowsVirtualKeyCode: input.keyCode,
        modifiers: input.modifiers,
      };
      if (input.text) params.text = input.text;
      // Chrome on macOS selects all only through the editing command, not the key press.
      if (input.event === "down" && input.key.toLowerCase() === "a" && input.modifiers & 6) params.commands = ["selectAll"];
      return ["Input.dispatchKeyEvent", params];
    }
    case "text":
      return ["Input.insertText", { text: input.text }];
  }
}

export type Screen = {
  state(): BrowserState;
  /** Sends `state` now and on every change, plus the shown tab's frames while subscribed. */
  subscribe(listener: (event: BrowserStreamEvent) => void): () => void;
  /** Drops the connection to a browser that stopped or was replaced; connects to a running one while someone watches. */
  sync(): Promise<void>;
  /** Starts the browser if needed; opens `url` (already checked with `browserURL`) in the shown tab. */
  open(url?: string): Promise<void>;
  nav(action: "back" | "reload"): Promise<void>;
  tab(id: string): Promise<void>;
  input(input: BrowserInput): Promise<void>;
  close(): Promise<void>;
  dispose(): void;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The browser panel's side of the open folder's browser. */
export function createScreen(opts: { browser(): Browser | undefined; connect?: (port: number) => Promise<Cdp> }): Screen {
  const listeners = new Set<(event: BrowserStreamEvent) => void>();
  const tabs = new Map<string, Tab>();
  let cdp: Cdp | undefined;
  let owner: Browser | undefined;
  let connecting: Promise<Cdp | undefined> | undefined;
  let active: string | null = null;
  let session: string | undefined;
  let showing: Promise<void> = Promise.resolve();
  let casting = false;
  let lastFrame: Frame | undefined;
  let error: string | undefined;

  const state = (): BrowserState => {
    const b = opts.browser();
    return {
      available: b !== undefined,
      running: b?.running() ?? false,
      agent: b?.agentAttached() ?? false,
      tabs: [...tabs.values()],
      active,
      ...(error === undefined ? {} : { error }),
    };
  };
  const emit = (event: BrowserStreamEvent) => {
    for (const listener of listeners) listener(event);
  };
  const push = () => emit({ type: "state", state: state() });

  const forget = () => {
    tabs.clear();
    active = null;
    session = undefined;
    casting = false;
    lastFrame = undefined;
  };
  const drop = () => {
    const c = cdp;
    cdp = undefined;
    owner = undefined;
    forget();
    c?.close();
  };

  async function cast(on: boolean) {
    const c = cdp;
    const s = session;
    if (!c || !s || casting === on) return;
    casting = on;
    await c.send(on ? "Page.startScreencast" : "Page.stopScreencast", on ? { format: "jpeg", quality: 70 } : {}, s).catch(() => {});
  }

  /** Shows tab `id`: attaches to it (detaching the previous one) and streams it while someone watches. */
  function show(id: string): Promise<void> {
    const c = cdp;
    if (!c) return Promise.resolve();
    const previous = session;
    active = id;
    session = undefined;
    casting = false;
    lastFrame = undefined;
    push();
    showing = (async () => {
      if (previous) await c.send("Target.detachFromTarget", { sessionId: previous }).catch(() => {});
      const { sessionId } = (await c.send("Target.attachToTarget", { targetId: id, flatten: true })) as { sessionId: string };
      if (active !== id || cdp !== c) {
        await c.send("Target.detachFromTarget", { sessionId }).catch(() => {});
        return;
      }
      session = sessionId;
      await c.send("Target.activateTarget", { targetId: id }).catch(() => {});
      await c.send("Page.enable", {}, sessionId).catch(() => {});
      if (listeners.size > 0) await cast(true);
    })().catch(() => {});
    return showing;
  }

  const onEvent = (c: Cdp) => (method: string, params: Params, sessionId: string | undefined) => {
    if (c !== cdp) return;
    if (method === "Page.screencastFrame") {
      if (sessionId === undefined || sessionId !== session) return;
      void c.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId).catch(() => {});
      const meta = params.metadata as { deviceWidth: number; deviceHeight: number };
      lastFrame = { type: "frame", data: params.data as string, width: meta.deviceWidth, height: meta.deviceHeight };
      emit(lastFrame);
      return;
    }
    const info = params.targetInfo as TargetInfo | undefined;
    if (method === "Target.targetCreated" && info?.type === "page") {
      tabs.set(info.targetId, { id: info.targetId, title: info.title, url: info.url });
      void show(info.targetId);
    } else if (method === "Target.targetInfoChanged" && info && tabs.has(info.targetId)) {
      tabs.set(info.targetId, { id: info.targetId, title: info.title, url: info.url });
      push();
    } else if (method === "Target.targetDestroyed") {
      const id = params.targetId as string;
      if (!tabs.delete(id)) return;
      if (active !== id) return push();
      active = null;
      session = undefined;
      casting = false;
      lastFrame = undefined;
      const last = [...tabs.keys()].at(-1);
      if (last) void show(last);
      else push();
    }
  };

  function connect(): Promise<Cdp | undefined> {
    if (cdp) return Promise.resolve(cdp);
    connecting ??= (async () => {
      const b = opts.browser();
      const port = b?.cdpPort();
      if (!b || port === undefined) return undefined;
      const c = await (opts.connect ?? connectCdp)(port);
      cdp = c;
      owner = b;
      c.on(onEvent(c));
      c.onClose(() => {
        if (cdp !== c) return;
        cdp = undefined;
        owner = undefined;
        forget();
        push();
      });
      await c.send("Target.setDiscoverTargets", { discover: true });
      const { targetInfos } = (await c.send("Target.getTargets")) as { targetInfos: TargetInfo[] };
      for (const t of targetInfos) {
        if (t.type === "page" && !tabs.has(t.targetId)) tabs.set(t.targetId, { id: t.targetId, title: t.title, url: t.url });
      }
      const last = [...tabs.keys()].at(-1);
      if (active === null && last) await show(last);
      else push();
      return c;
    })().finally(() => (connecting = undefined));
    return connecting;
  }

  /** The connection and the shown tab's session, once attached. */
  async function ready(): Promise<{ c: Cdp; s: string }> {
    const c = cdp ?? (opts.browser()?.running() ? await connect() : undefined);
    await showing;
    if (!c || !session) throw new Error("the browser is not open");
    return { c, s: session };
  }

  async function sync() {
    const b = opts.browser();
    if (cdp && (b !== owner || !b?.running())) drop();
    if (b?.running() && !cdp && listeners.size > 0) {
      try {
        await connect();
      } catch (err) {
        error = message(err);
      }
    }
    push();
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      listener({ type: "state", state: state() });
      if (lastFrame) listener(lastFrame);
      if (listeners.size === 1) void (cdp ? cast(true) : sync());
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) void cast(false);
      };
    },
    sync,
    async open(url) {
      const b = opts.browser();
      if (!b) throw new Error("the built-in browser is off in this folder");
      error = undefined;
      try {
        await b.launch();
        if (cdp && owner !== b) drop();
        if (!(await connect())) throw new Error("could not find the browser's debugging port");
      } catch (err) {
        error = message(err);
        push();
        throw err;
      }
      if (url) {
        const { c, s } = await ready();
        await c.send("Page.navigate", { url }, s);
      }
      push();
    },
    async nav(action) {
      const { c, s } = await ready();
      if (action === "reload") {
        await c.send("Page.reload", {}, s);
        return;
      }
      const history = (await c.send("Page.getNavigationHistory", {}, s)) as { currentIndex: number; entries: { id: number }[] };
      const entry = history.entries[history.currentIndex - 1];
      if (entry) await c.send("Page.navigateToHistoryEntry", { entryId: entry.id }, s);
    },
    async tab(id) {
      if (!tabs.has(id)) throw new Error(`no tab "${id}"`);
      await show(id);
    },
    async input(input) {
      const { c, s } = await ready();
      const [method, params] = cdpInput(input);
      await c.send(method, params, s);
    },
    async close() {
      const b = opts.browser();
      drop();
      error = undefined;
      await b?.close();
      push();
    },
    dispose() {
      listeners.clear();
      drop();
    },
  };
}
```

- [ ] **Step 6: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/screen.test.ts`
Expected：PASS。

- [ ] **Step 7: 提交**

按 code-commit 技能提交 `packages/cli/src/serve/protocol.ts`、`packages/cli/src/serve/screen.ts`、`packages/cli/src/index.ts`、`packages/cli/test/fixtures/fake-cdp.ts`、`packages/cli/test/screen.test.ts`。参考信息：`feat(serve): 浏览器面板的 CDP 连接、截屏分发、输入和地址检查`。

---

### Task 4: `/api/browser*` 接口

**Files:**
- Modify: `packages/cli/src/serve/http.ts`
- Test: `packages/cli/test/serve.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `ChatHost.browser`；Task 3 的 `createScreen`、`browserURL`、`parseInput`、`Cdp`。
- Produces: `ServeOptions.connectCdp?: (port: number) => Promise<Cdp>`；接口 `GET /api/browser`、`GET /api/browser/stream`、`POST /api/browser/{open,nav,tab,input,close}`。

- [ ] **Step 1: 写失败的测试**

`packages/cli/test/serve.test.ts`：

1. import 加 `import { fakeBrowser, fakeCdp } from "./fixtures/fake-cdp.ts";`
2. `fakeServer` 加第三个参数并传给 `createServeHandler`：

```ts
async function fakeServer(
  webDir = path.join(tmpdir(), "tah-no-web"),
  chooseFolder: (start?: string) => Promise<string | null> = async () => null,
  connectCdp?: (port: number) => Promise<unknown>,
) {
```

`createServeHandler({ … chooseFolder, })` 里 `chooseFolder,` 之后加 `...(connectCdp ? { connectCdp } : {}),`。

3. `stream` 函数之后加：

```ts
type BrowserEvent = { type: string; state?: { active: string | null }; data?: string };

/** `GET /api/browser/stream`; `until(pred, from)` resolves with the first matching event at index `from` or later. */
function browserEvents(base: string, cookie: string) {
  const events: BrowserEvent[] = [];
  const waiters: Array<() => void> = [];
  const req = request(new URL("/api/browser/stream", base), { headers: { cookie } }, (res) => {
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part.split("\n").find((l) => l.startsWith("data: "));
        if (data) events.push(JSON.parse(data.slice(6)));
      }
      for (const w of waiters.splice(0)) w();
    });
  });
  req.on("error", () => {});
  req.end();
  const until = (pred: (e: BrowserEvent) => boolean, from = 0) =>
    new Promise<BrowserEvent>((resolve) => {
      const check = () => {
        const e = events.find((x, i) => i >= from && pred(x));
        if (e) resolve(e);
        else waiters.push(check);
      };
      check();
    });
  return { events, until, close: () => req.destroy() };
}
```

4. 文件末尾加：

```ts
test("browser endpoints need sign-in and same origin; a folder without the browser reports it off", async () => {
  const s = await fakeServer();
  try {
    assert.equal((await client(s.base).get("/api/browser")).status, 401);
    const cross = await raw(s.base, "POST", "/api/browser/open", {
      headers: { cookie: s.cookie, origin: "http://evil.test", "content-type": "application/json" },
      body: {},
    });
    assert.equal(cross.status, 403);
    const api = client(s.base, s.cookie);
    assert.deepEqual(JSON.parse((await api.get("/api/browser")).body), {
      available: false,
      running: false,
      agent: false,
      tabs: [],
      active: null,
    });
    const open = await api.post("/api/browser/open", {});
    assert.equal(open.status, 400);
    assert.match(JSON.parse(open.body).error, /browser is off/);
    const self = await api.post("/api/browser/open", { url: `${s.base}api/events` });
    assert.equal(self.status, 400);
    assert.match(JSON.parse(self.body).error, /not tah itself/);
    assert.equal((await api.post("/api/browser/nav", { action: "forward" })).status, 400);
    assert.equal((await api.post("/api/browser/input", { type: "mouse" })).status, 400);
  } finally {
    await s.close();
  }
});

test("browser panel over HTTP: open, stream frames, type; a browser tool event reconnects it", async () => {
  const conns = [fakeCdp(), fakeCdp()];
  let n = 0;
  const s = await fakeServer(undefined, undefined, async () => conns[n++]!.cdp);
  const fb = fakeBrowser();
  Object.assign(s.host, { browser: fb.browser });
  const api = client(s.base, s.cookie);
  const watch = browserEvents(s.base, s.cookie);
  try {
    await watch.until((e) => e.type === "state");
    const opened = await api.post("/api/browser/open", { url: "https://example.com/" });
    assert.equal(opened.status, 200);
    assert.equal(JSON.parse(opened.body).active, "T1");
    const navigations = () => conns[0]!.sent.filter((m) => m.method === "Page.navigate").map((m) => m.params.url);
    assert.deepEqual(navigations(), ["https://example.com/"]);
    assert.equal((await api.post("/api/browser/open", { url: "/preview/abc/a.html" })).status, 200);
    assert.equal(navigations().at(-1), `${s.base}preview/abc/a.html`);

    conns[0]!.event("Page.screencastFrame", { data: "AAAA", sessionId: 1, metadata: { deviceWidth: 1280, deviceHeight: 720 } }, "S-T1");
    assert.deepEqual(await watch.until((e) => e.type === "frame"), { type: "frame", data: "AAAA", width: 1280, height: 720 });

    assert.equal((await api.post("/api/browser/input", { type: "text", text: "hi" })).status, 204);
    assert.deepEqual(conns[0]!.sent.at(-1), { method: "Input.insertText", params: { text: "hi" }, sessionId: "S-T1" });
    assert.equal((await api.post("/api/browser/nav", { action: "reload" })).status, 204);

    const from = watch.events.length;
    conns[0]!.cdp.close();
    s.emit({ type: "tool.end", callId: "c1", tool: "browser_click", summary: "", ok: true, result: "" });
    await watch.until((e) => e.type === "state" && e.state?.active === "T1", from);
    assert.equal(n, 2);

    assert.equal((await api.post("/api/browser/close")).status, 204);
    assert.equal(fb.closes(), 1);
  } finally {
    watch.close();
    await s.close();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/serve.test.ts`
Expected：FAIL（`/api/browser` 404）。

- [ ] **Step 3: 实现**

`packages/cli/src/serve/http.ts`：

1. import：`./protocol.js` 那行不变；加

```ts
import { browserURL, createScreen, parseInput, type Cdp } from "./screen.js";
```

2. `ServeOptions` 末尾 `chooseFolder?` 之后加：

```ts
  /** Chrome DevTools connection for the browser panel; defaults to the real one (tests inject a fake). */
  connectCdp?: (port: number) => Promise<Cdp>;
```

3. `const previewToken = …;` 之后加：

```ts
  const screen = createScreen({
    browser: () => host().browser,
    ...(opts.connectCdp ? { connect: opts.connectCdp } : {}),
  });
  // The agent's browser tools and folder switches change the browser behind the panel.
  const unsubscribeScreen = hub.subscribe((event) => {
    if (event.type === "session" || (event.type === "tool.end" && event.tool.startsWith("browser_"))) void screen.sync();
  });
```

4. `events` 函数之后加：

```ts
  /** Frames a slow tab cannot take are replaced by the newest one; `state` events always go out. */
  const browserStream = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    streams.add(res);
    let blocked = false;
    let waiting: string | undefined;
    const send = (chunk: string) => {
      blocked = !res.write(chunk);
    };
    res.on("drain", () => {
      blocked = false;
      const chunk = waiting;
      waiting = undefined;
      if (chunk) send(chunk);
    });
    const unsubscribe = screen.subscribe((event) => {
      const chunk = `data: ${JSON.stringify(event)}\n\n`;
      if (event.type === "frame" && blocked) waiting = chunk;
      else send(chunk);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  };
```

5. `api` 的 `switch (key)` 里，`case "GET /api/fs": {` 之前加：

```ts
      case "GET /api/browser":
        return json(res, 200, screen.state());
      case "GET /api/browser/stream":
        return browserStream(req, res);
      case "POST /api/browser/open": {
        const input = optStr(await readBody(req), "url");
        const url = input === undefined ? undefined : browserURL(input, req.socket.localPort ?? 0);
        if (input !== undefined && url === undefined) {
          throw new HttpError(400, "only http(s) pages (not tah itself), about:blank or a file preview can be opened");
        }
        await screen.open(url);
        return json(res, 200, screen.state());
      }
      case "POST /api/browser/nav": {
        const action = (await readBody(req)).action;
        if (action !== "back" && action !== "reload") throw new HttpError(400, '"action" must be "back" or "reload"');
        await screen.nav(action);
        return json(res, 204);
      }
      case "POST /api/browser/tab":
        await screen.tab(str(await readBody(req), "id"));
        return json(res, 204);
      case "POST /api/browser/input":
        await screen.input(parseInput(await readBody(req)));
        return json(res, 204);
      case "POST /api/browser/close":
        await screen.close();
        return json(res, 204);
```

6. `closeAll()` 改为：

```ts
    closeAll() {
      unsubscribeScreen();
      screen.dispose();
      for (const res of streams) res.end();
      streams.clear();
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/cli && node --test --experimental-strip-types test/serve.test.ts test/screen.test.ts test/serve-workspaces.test.ts`
Expected：PASS。

- [ ] **Step 5: 提交**

按 code-commit 技能提交 `packages/cli/src/serve/http.ts`、`packages/cli/test/serve.test.ts`。参考信息：`feat(serve): 浏览器面板接口：状态、画面流、打开、输入、关闭`。

---

### Task 5: 网页的纯函数和接口方法

**Files:**
- Create: `packages/web/src/browser-view.ts`
- Modify: `packages/web/src/api.ts`
- Test: `packages/web/test/browser-view.test.ts`（新）

**Interfaces:**
- Consumes: Task 3 的 `BrowserInput`、`BrowserState`、`BrowserStreamEvent`、`ServeRequest["browserOpen" | "browserNav" | "browserTab"]`。
- Produces（`browser-view.ts`）：

  ```ts
  export function modifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number;
  export function opensInPanel(href: string | undefined, click: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button: number }, origin: string): boolean;
  export function addressURL(text: string): string;
  export function toPage(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, frame: { width: number; height: number }): { x: number; y: number };
  export function mouseButton(button: number): "left" | "middle" | "right";
  export function keyInput(e: { key: string; code: string; keyCode: number; isComposing: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, event: "down" | "up"): BrowserInput | null;
  export function agentBrowsing(entries: Entry[]): boolean;
  export function opensBrowser(event: HostEvent): boolean;
  ```
- Produces（`api.ts`）：`api.browserState()`、`api.browserOpen(body?)`（返回 `BrowserState`）、`api.browserNav(body)`、`api.browserTab(body)`、`api.browserInput(input)`、`api.browserClose()`；`export function browserStream(onEvent: (event: BrowserStreamEvent) => void): () => void`。

- [ ] **Step 1: 写失败的测试**

新建 `packages/web/test/browser-view.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addressURL,
  agentBrowsing,
  keyInput,
  modifiers,
  mouseButton,
  opensBrowser,
  opensInPanel,
  toPage,
} from "../src/browser-view.ts";

const none = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
const ORIGIN = "http://127.0.0.1:7433";

test("plain clicks on web links open in the panel; modified clicks and tah's own links do not", () => {
  const click = { ...none, button: 0 };
  assert.equal(opensInPanel("https://example.com/a", click, ORIGIN), true);
  assert.equal(opensInPanel("http://localhost:3000/", click, ORIGIN), true);
  for (const href of ["http://127.0.0.1:7433/x", "http://localhost:7433/", "mailto:a@b.c", "ftp://x/", "not a url", undefined]) {
    assert.equal(opensInPanel(href, click, ORIGIN), false, String(href));
  }
  for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    assert.equal(opensInPanel("https://example.com", { ...click, [mod]: true }, ORIGIN), false, mod);
  }
  assert.equal(opensInPanel("https://example.com", { ...click, button: 1 }, ORIGIN), false);
});

test("address bar: bare hosts get a scheme, the rest goes as typed", () => {
  assert.equal(addressURL(" example.com "), "https://example.com");
  assert.equal(addressURL("localhost:3000/a"), "http://localhost:3000/a");
  assert.equal(addressURL("127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(addressURL("https://x.dev/?q=1"), "https://x.dev/?q=1");
  assert.equal(addressURL("about:blank"), "about:blank");
  assert.equal(addressURL("/preview/t/a.html"), "/preview/t/a.html");
  assert.equal(addressURL("   "), "");
});

test("points on the scaled frame map to page pixels", () => {
  assert.deepEqual(toPage(110, 70, { left: 10, top: 20, width: 640, height: 360 }, { width: 1280, height: 720 }), { x: 200, y: 100 });
});

test("modifier bits and mouse buttons follow CDP", () => {
  assert.equal(modifiers(none), 0);
  assert.equal(modifiers({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }), 15);
  assert.equal(modifiers({ ...none, metaKey: true }), 4);
  assert.deepEqual([0, 1, 2].map(mouseButton), ["left", "middle", "right"]);
});

test("keys: special keys and shortcuts are sent; typed characters, IME and clipboard shortcuts are not", () => {
  const key = (k: string, code: string, keyCode: number, extra: Partial<typeof none & { isComposing: boolean }> = {}) => ({
    ...none,
    key: k,
    code,
    keyCode,
    isComposing: false,
    ...extra,
  });
  assert.deepEqual(keyInput(key("Enter", "Enter", 13), "down"), {
    type: "key",
    event: "down",
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    modifiers: 0,
    text: "\r",
  });
  assert.deepEqual(keyInput(key("Enter", "Enter", 13), "up"), { type: "key", event: "up", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0 });
  assert.deepEqual(keyInput(key("Backspace", "Backspace", 8), "down"), {
    type: "key",
    event: "down",
    key: "Backspace",
    code: "Backspace",
    keyCode: 8,
    modifiers: 0,
  });
  assert.deepEqual(keyInput(key("a", "KeyA", 65, { metaKey: true }), "down"), {
    type: "key",
    event: "down",
    key: "a",
    code: "KeyA",
    keyCode: 65,
    modifiers: 4,
  });
  assert.equal(keyInput(key("a", "KeyA", 65), "down"), null);
  assert.equal(keyInput(key("A", "KeyA", 65, { shiftKey: true }), "down"), null);
  assert.equal(keyInput(key("Enter", "Enter", 13, { isComposing: true }), "down"), null);
  assert.equal(keyInput(key("Process", "KeyN", 229), "down"), null);
  for (const k of ["c", "v", "x"]) {
    assert.equal(keyInput(key(k, `Key${k.toUpperCase()}`, 0, { metaKey: true }), "down"), null, k);
  }
});

test("the agent is browsing while a browser tool runs; browser_open opens the panel", () => {
  const tool = (name: string, status: "running" | "ok" | "failed") =>
    ({ id: 1, kind: "tool", callId: "c", tool: name, summary: "", status, result: "" }) as const;
  assert.equal(agentBrowsing([tool("browser_click", "running")]), true);
  assert.equal(agentBrowsing([tool("browser_click", "ok"), tool("read_file", "running")]), false);
  assert.equal(opensBrowser({ type: "tool.start", callId: "c", tool: "browser_open", summary: "" }), true);
  assert.equal(opensBrowser({ type: "tool.start", callId: "c", tool: "browser_click", summary: "" }), false);
  assert.equal(opensBrowser({ type: "tool.end", callId: "c", tool: "browser_open", summary: "", ok: true, result: "" }), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run：`cd packages/web && node --test --experimental-strip-types test/browser-view.test.ts`
Expected：FAIL（找不到 `../src/browser-view.ts`）。

- [ ] **Step 3: 实现**

新建 `packages/web/src/browser-view.ts`：

```ts
import type { BrowserInput, HostEvent } from "@typescript-agent-harness/cli";
import type { Entry } from "./state";

type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
type KeyInput = Extract<BrowserInput, { type: "key" }>;

/** CDP modifier bits. */
export function modifiers(e: Mods): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const local = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "[::1]";

/** A plain click on an http(s) link opens it in the browser panel; modified clicks and links to tah itself (`origin`) do not. */
export function opensInPanel(href: string | undefined, click: Mods & { button: number }, origin: string): boolean {
  if (!href || click.button !== 0 || click.altKey || click.ctrlKey || click.metaKey || click.shiftKey) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const self = new URL(origin);
  return !(local(url.hostname) && local(self.hostname) && url.port === self.port);
}

/** What the address bar sends: `localhost:3000` → `http://localhost:3000`, `example.com` → `https://example.com`; full URLs, `about:` and `/…` as typed. */
export function addressURL(text: string): string {
  const t = text.trim();
  if (!t || /^[a-z][a-z\d+.-]*:\/\//i.test(t) || /^about:/i.test(t) || t.startsWith("/")) return t;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(t) ? `http://${t}` : `https://${t}`;
}

/** A point on the drawn frame (`rect`) in page CSS pixels. */
export function toPage(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number } {
  return { x: ((clientX - rect.left) / rect.width) * frame.width, y: ((clientY - rect.top) / rect.height) * frame.height };
}

export function mouseButton(button: number): "left" | "middle" | "right" {
  return button === 1 ? "middle" : button === 2 ? "right" : "left";
}

const CLIPBOARD = new Set(["c", "v", "x"]);

/** Key presses sent as keys: special keys and shortcuts. Typed characters arrive as `text` from the input box instead; IME composition and copy / paste / cut are left to the box. */
export function keyInput(e: Mods & { key: string; code: string; keyCode: number; isComposing: boolean }, event: "down" | "up"): BrowserInput | null {
  if (e.isComposing || e.key === "Process" || e.key === "Dead") return null;
  const shortcut = e.metaKey || e.ctrlKey;
  if (e.key.length === 1 && !shortcut) return null;
  if (shortcut && CLIPBOARD.has(e.key.toLowerCase())) return null;
  const input: KeyInput = { type: "key", event, key: e.key, code: e.code, keyCode: e.keyCode, modifiers: modifiers(e) };
  return e.key === "Enter" && event === "down" ? { ...input, text: "\r" } : input;
}

/** A browser tool is running. */
export function agentBrowsing(entries: Entry[]): boolean {
  return entries.some((e) => e.kind === "tool" && e.status === "running" && e.tool.startsWith("browser_"));
}

/** The agent starts using the browser: show the panel. */
export function opensBrowser(event: HostEvent): boolean {
  return event.type === "tool.start" && event.tool === "browser_open";
}
```

`packages/web/src/api.ts`：

1. 类型 import 里按字母序加 `BrowserInput`、`BrowserState`、`BrowserStreamEvent`（放在 `AttachmentMeta` 之后）。
2. `api` 对象末尾 `removeSkill: …,` 之后加：

```ts
  browserState: async () => (await (await call("GET", "/api/browser")).json()) as BrowserState,
  browserOpen: async (body: ServeRequest["browserOpen"] = {}) =>
    (await (await call("POST", "/api/browser/open", body)).json()) as BrowserState,
  browserNav: (body: ServeRequest["browserNav"]) => post("/api/browser/nav", body),
  browserTab: (body: ServeRequest["browserTab"]) => post("/api/browser/tab", body),
  browserInput: (input: BrowserInput) => post("/api/browser/input", input),
  browserClose: () => post("/api/browser/close"),
```

3. 文件末尾加：

```ts
/** The browser panel's stream: `state` on every change, the shown tab's frames while connected. */
export function browserStream(onEvent: (event: BrowserStreamEvent) => void): () => void {
  const source = new EventSource("/api/browser/stream");
  source.onmessage = (message) => onEvent(JSON.parse(message.data as string) as BrowserStreamEvent);
  return () => source.close();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run：`pnpm --filter @typescript-agent-harness/cli build && cd packages/web && node --test --experimental-strip-types test/*.test.ts && pnpm typecheck`
Expected：PASS，typecheck 无错误。

- [ ] **Step 5: 提交**

按 code-commit 技能提交 `packages/web/src/browser-view.ts`、`packages/web/src/api.ts`、`packages/web/test/browser-view.test.ts`。参考信息：`feat(web): 浏览器面板的纯函数和接口方法`。

---

### Task 6: 浏览器面板界面

**Files:**
- Create: `packages/web/src/components/SidePanel.tsx`
- Create: `packages/web/src/components/BrowserPane.tsx`
- Modify: `packages/web/src/components/FilePreview.tsx`
- Modify: `packages/web/src/components/Messages.tsx`
- Modify: `packages/web/src/components/StatusBar.tsx`
- Modify: `packages/web/src/components/ApprovalCard.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/styles.css`

**Interfaces:**
- Consumes: Task 5 的 `browser-view.ts` 全部函数、`api.browser*`、`browserStream`。
- Produces: `SidePanel(props: { view: "file" | "browser"; both: boolean; onView(view: "file" | "browser"): void; children: ReactNode })`；`BrowserPane(props: { agentBusy: boolean; onClose(): void })`；`FilePreview` 多可选 `onBrowse?: (url: string) => void`；`Messages` 多 `onBrowse: ((url: string) => void) | undefined`；`StatusBar` 多 `onBrowser: (() => void) | undefined`。

这个任务是界面，没有单元测试；验证靠 typecheck、构建和 Step 9 的手动冒烟。

- [ ] **Step 1: `SidePanel.tsx`（外壳从 `FilePreview` 移出来）**

新建 `packages/web/src/components/SidePanel.tsx`：

```tsx
import { useRef, useState, type PointerEvent, type ReactNode } from "react";

const WIDTH = "tah.previewWidth";

/** The right-hand panel: resizable (width remembered), with a File / Browser switch when both are open. */
export function SidePanel(props: {
  view: "file" | "browser";
  both: boolean;
  onView(view: "file" | "browser"): void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() =>
    Math.max(Math.min(Number(localStorage.getItem(WIDTH)) || 480, window.innerWidth - 360), 280),
  );
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = Math.max(Math.min(drag.current.width + drag.current.x - e.clientX, window.innerWidth - 360), 280);
    setWidth(next);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = undefined;
    localStorage.setItem(WIDTH, String(width));
  };

  return (
    <aside className="side-panel" style={{ width }}>
      <div className="preview-resize" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} />
      {props.both ? (
        <div className="side-switch" role="tablist">
          {(["file", "browser"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={props.view === view}
              className={props.view === view ? "active" : ""}
              onClick={() => props.onView(view)}
            >
              {view === "file" ? "File" : "Browser"}
            </button>
          ))}
        </div>
      ) : null}
      {props.children}
    </aside>
  );
}
```

- [ ] **Step 2: `FilePreview.tsx`**

1. 第二行 import 改为 `import { useEffect, useState } from "react";`；删掉 `const WIDTH = "tah.previewWidth";`。
2. props 类型加 `onBrowse?: (url: string) => void;`（放在 `onOpen` 之后），解构改为 `const { target, version, onOpen, onBrowse, onClose } = props;`。
3. 删掉 `width` 状态、`drag` ref、`startDrag` / `moveDrag` / `endDrag` 三个函数。
4. `const title = …;` 之后加 `const browsable = stat?.kind === "html" ? stat.previewURL : undefined;`。
5. `return (` 里，`<aside className="file-preview" style={{ width }}>` 和它下一行 `preview-resize` 换成 `<>`，结尾 `</aside>` 换成 `</>`。
6. 「Source / Rendered」按钮那段之后加：

```tsx
        {browsable && onBrowse ? (
          <button type="button" onClick={() => onBrowse(browsable)}>
            Open in browser
          </button>
        ) : null}
```

- [ ] **Step 3: `BrowserPane.tsx`**

新建 `packages/web/src/components/BrowserPane.tsx`：

```tsx
import type { BrowserInput, BrowserState } from "@typescript-agent-harness/cli";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { api, browserStream } from "../api";
import { addressURL, keyInput, modifiers, mouseButton, toPage } from "../browser-view";

/** Mouse moves and wheel turns go out at most this often. */
const THROTTLE_MS = 30;

type Frame = { src: string; width: number; height: number };

/** The built-in browser's live page: watch the agent, or click and type in it yourself. */
export function BrowserPane(props: { agentBusy: boolean; onClose(): void }) {
  const [state, setState] = useState<BrowserState>();
  const [frame, setFrame] = useState<Frame>();
  const [address, setAddress] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const image = useRef<HTMLImageElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastMove = useRef(0);
  const wheel = useRef<{ x: number; y: number; dx: number; dy: number; modifiers: number } | undefined>(undefined);
  const composing = useRef(false);

  useEffect(
    () =>
      browserStream((event) => {
        if (event.type === "frame") {
          setFrame({ src: `data:image/jpeg;base64,${event.data}`, width: event.width, height: event.height });
          return;
        }
        setState(event.state);
        if (!event.state.running) setFrame(undefined);
      }),
    [],
  );

  const run = (pending: Promise<unknown>) => {
    setFailed(undefined);
    pending.catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)));
  };
  /** One at a time, so a click's press and release reach the page in order. */
  const send = (input: BrowserInput) => {
    queue.current = queue.current.then(() => api.browserInput(input)).catch(() => {});
  };

  const tab = state?.tabs.find((t) => t.id === state.active);
  const shown = address ?? tab?.url ?? "";

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = image.current?.getBoundingClientRect();
    if (!rect || !frame) return undefined;
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return undefined;
    return toPage(e.clientX, e.clientY, rect, frame);
  };
  const press = (e: ReactMouseEvent, event: "down" | "up") => {
    const p = point(e);
    if (p) send({ type: "mouse", event, ...p, button: mouseButton(e.button), clickCount: Math.max(e.detail, 1), modifiers: modifiers(e) });
  };
  const move = (e: ReactMouseEvent) => {
    if (Date.now() - lastMove.current < THROTTLE_MS) return;
    const p = point(e);
    if (!p) return;
    lastMove.current = Date.now();
    send({ type: "mouse", event: "move", ...p, button: e.buttons & 1 ? "left" : "none", clickCount: 0, modifiers: modifiers(e) });
  };
  const turn = (e: ReactWheelEvent) => {
    const pending = wheel.current;
    if (pending) {
      pending.dx += e.deltaX;
      pending.dy += e.deltaY;
      return;
    }
    const p = point(e);
    if (!p) return;
    wheel.current = { ...p, dx: e.deltaX, dy: e.deltaY, modifiers: modifiers(e) };
    setTimeout(() => {
      const w = wheel.current;
      wheel.current = undefined;
      if (w) send({ type: "wheel", ...w });
    }, THROTTLE_MS);
  };
  const key = (e: ReactKeyboardEvent, event: "down" | "up") => {
    const input = keyInput(
      {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing || composing.current,
      },
      event,
    );
    if (!input) return;
    e.preventDefault();
    send(input);
  };
  const typed = () => {
    const el = keys.current;
    if (!el?.value) return;
    send({ type: "text", text: el.value });
    el.value = "";
  };

  return (
    <>
      <div className="preview-head browser-head">
        <button type="button" disabled={!state?.running} onClick={() => run(api.browserNav({ action: "back" }))} aria-label="Back" title="Back">
          ←
        </button>
        <button type="button" disabled={!state?.running} onClick={() => run(api.browserNav({ action: "reload" }))} aria-label="Reload" title="Reload">
          ↻
        </button>
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            const url = addressURL(shown);
            if (!url) return;
            setAddress(undefined);
            run(api.browserOpen({ url }));
          }}
        >
          <input
            value={shown}
            placeholder="Enter a URL"
            spellCheck={false}
            aria-label="Address"
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => setAddress(undefined)}
          />
        </form>
        {state && state.tabs.length > 1 ? (
          <select value={state.active ?? ""} aria-label="Tabs" onChange={(e) => run(api.browserTab({ id: e.target.value }))}>
            {state.tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title || t.url}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          disabled={!tab || !/^https?:/.test(tab.url)}
          onClick={() => tab && window.open(tab.url, "_blank", "noreferrer")}
          aria-label="Open in system browser"
          title="Open in system browser"
        >
          ↗
        </button>
        <button
          type="button"
          disabled={!state?.running}
          onClick={() => {
            if (state?.agent && !window.confirm("The agent is using this browser. Close it anyway?")) return;
            run(api.browserClose());
          }}
          aria-label="Close browser"
          title="Close browser"
        >
          ⏻
        </button>
        <button type="button" onClick={props.onClose} aria-label="Hide" title="Hide">
          ✕
        </button>
      </div>
      {props.agentBusy ? <div className="browser-agent">Agent is using the browser</div> : null}
      {failed || state?.error ? <div className="preview-note browser-error">{failed ?? state?.error}</div> : null}
      <div className="browser-screen">
        {state?.running && frame ? (
          <div className="browser-frame">
            <img ref={image} src={frame.src} alt={tab?.title || "Page"} draggable={false} />
            <textarea
              ref={keys}
              className="browser-keys"
              aria-label="Type into the page"
              spellCheck={false}
              onMouseDown={(e) => press(e, "down")}
              onMouseUp={(e) => press(e, "up")}
              onMouseMove={move}
              onWheel={turn}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => key(e, "down")}
              onKeyUp={(e) => key(e, "up")}
              onInput={() => {
                if (!composing.current) typed();
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
                typed();
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text/plain");
                if (text) send({ type: "text", text });
              }}
            />
          </div>
        ) : (
          <div className="preview-empty">
            {state && !state.running ? "Enter a URL above to open the browser" : <span className="spinner" />}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: `Messages.tsx`：http(s) 链接在面板打开**

1. import 加 `import { opensInPanel } from "../browser-view";`；`type Open = …;` 之后加 `type Browse = ((url: string) => void) | undefined;`。
2. `fileLinks(onOpen: Open)` 改为 `fileLinks(onOpen: Open, onBrowse: Browse)`，其中 `if (!file) return <a href={href} {...rest}>{children}</a>;` 替换为：

```tsx
      if (!file) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            {...rest}
            onClick={(e) => {
              if (!onBrowse || !href || !opensInPanel(href, e, location.origin)) return;
              e.preventDefault();
              onBrowse(href);
            }}
          >
            {children}
          </a>
        );
      }
```

3. `Reply` 改为：

```tsx
const Reply = memo(function Reply({ text, onOpen, onBrowse }: { text: string; onOpen: Open; onBrowse: Browse }) {
  const components = useMemo(() => fileLinks(onOpen, onBrowse), [onOpen, onBrowse]);
```

（其余不变。）

4. `Row` 的 props 改为 `{ entry, onOpen, onBrowse }: { entry: Entry; onOpen: Open; onBrowse: Browse }`，`case "assistant":` 改为 `return <Reply text={entry.text} onOpen={onOpen} onBrowse={onBrowse} />;`。
5. `Steps` 的 props 加 `onBrowse: Browse`，两处 `<Row … onOpen={onOpen} />` 加 `onBrowse={onBrowse}`。
6. `Messages` 的 props 加 `onBrowse`（类型 `onBrowse: Browse;`），里面的 `<Row …/>` 和 `<Steps …/>` 都加 `onBrowse={onBrowse}`。

- [ ] **Step 5: `StatusBar.tsx` 和 `ApprovalCard.tsx`**

`StatusBar` props 加：

```ts
  /** Absent when the open folder has no built-in browser. */
  onBrowser: (() => void) | undefined;
```

`Compact` 按钮之前加：

```tsx
      {props.onBrowser ? (
        <button type="button" className="link" onClick={props.onBrowser} title="Open the built-in browser">
          Browser
        </button>
      ) : null}
```

`ApprovalCard.tsx` 里 `body: "Opens a Chrome window the agent can click and type in.",` 改为：

```ts
      body: "Opens a browser the agent can click and type in — watch or take over in the Browser panel.",
```

- [ ] **Step 6: `App.tsx`**

1. import：加 `import { BrowserPane } from "./components/BrowserPane";`、`import { SidePanel } from "./components/SidePanel";`、`import { agentBrowsing, opensBrowser } from "./browser-view";`。
2. `const closePreview = …;` 之后加：

```ts
  const [browserShown, setBrowserShown] = useState(false);
  const [browserAvailable, setBrowserAvailable] = useState(false);
  const [view, setView] = useState<"file" | "browser">("file");
  const openFile = useCallback((target: FileTarget) => {
    setPreview(target);
    setView("file");
  }, []);
  const showBrowser = useCallback(() => {
    setBrowserShown(true);
    setView("browser");
  }, []);
```

3. `onEvent(event) {` 里 `if (touchesFiles(event)) …;` 之后加 `if (opensBrowser(event)) showBrowser();`；`useEffect` 的依赖 `[enqueue]` 改为 `[enqueue, showBrowser]`。
4. `useEffect(() => setPreview(undefined), [state.sessionId]);` 之后加：

```ts
  useEffect(() => {
    if (connection !== "open") return;
    api.browserState().then((s) => setBrowserAvailable(s.available), () => {});
  }, [connection, state.sessionId]);
```

5. `const run = …;` 之后、`if (connection === "signed-out")` 之前加（hook 不能放在提前 return 之后）：

```ts
  const browse = useMemo(
    () =>
      browserAvailable
        ? (url: string) => {
            showBrowser();
            run(api.browserOpen({ url }));
          }
        : undefined,
    // `run` only wraps `enqueue`.
    [browserAvailable, showBrowser, enqueue],
  );
```

`const thinking = …;` 之后加：

```ts
  const fileOpen = preview !== undefined;
  const browserOpen = browserShown && browserAvailable;
  const side = fileOpen && browserOpen ? view : fileOpen ? "file" : browserOpen ? "browser" : undefined;
```

`react` 的 import 加 `useMemo`。

6. `<Messages entries={state.entries} busy={state.busy} onOpen={setPreview}>` 改为 `<Messages entries={state.entries} busy={state.busy} onOpen={openFile} onBrowse={browse}>`。
7. `<StatusBar` 加属性 `onBrowser={browserAvailable ? showBrowser : undefined}`。
8. 文件末尾 `{preview ? ( <FilePreview … /> ) : null}` 整段替换为：

```tsx
      {side ? (
        <SidePanel view={side} both={fileOpen && browserOpen} onView={setView}>
          {side === "file" && preview ? (
            <FilePreview
              key={fileQuery(preview)}
              target={preview}
              version={previewVersion}
              onOpen={openFile}
              onBrowse={browse}
              onClose={closePreview}
            />
          ) : (
            <BrowserPane agentBusy={agentBrowsing(state.entries)} onClose={() => setBrowserShown(false)} />
          )}
        </SidePanel>
      ) : null}
```

- [ ] **Step 7: `styles.css`**

1. 两处 `.file-preview`（`.file-preview {` 和 `@media (max-width: 900px)` 里的 `.file-preview {`）改名为 `.side-panel`。
2. `.preview-empty { … }` 之后、`@media (max-width: 900px)` 之前加：

```css
.side-switch {
  display: flex;
  gap: 4px;
  padding: 6px 10px 0;
  background: var(--panel);
}
.side-switch button {
  font-size: 12px;
  padding: 2px 10px;
}
.side-switch button.active {
  background: var(--bg);
  font-weight: 600;
}
.browser-address {
  flex: 1;
  min-width: 0;
  display: flex;
}
.browser-address input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 3px 8px;
}
.browser-head select {
  max-width: 120px;
  font-size: 12px;
}
.browser-agent {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--accent);
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.browser-error {
  margin: 0;
  padding: 4px 10px;
}
.browser-screen {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  background: var(--panel);
}
.browser-frame {
  position: relative;
}
.browser-frame img {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
}
.browser-keys {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  resize: none;
  opacity: 0;
  cursor: default;
  caret-color: transparent;
}
```

- [ ] **Step 8: typecheck 和构建**

Run：`pnpm --filter @typescript-agent-harness/cli build && pnpm --filter @typescript-agent-harness/web typecheck && pnpm --filter @typescript-agent-harness/web build && cd packages/web && node --test --experimental-strip-types test/*.test.ts`
Expected：全部成功。

- [ ] **Step 9: 冒烟（临时 HOME，真 Chrome）**

```bash
export SMOKE=$(mktemp -d) && mkdir -p "$SMOKE/home" "$SMOKE/work"
printf '<h1 style="color:teal">hello</h1><input placeholder="type here">' > "$SMOKE/work/page.html"
pnpm -r build
HOME="$SMOKE/home" node packages/cli/dist/cli.js serve --cwd "$SMOKE/work" --port 0 --no-open
```

（没有模型也能启动。）打开它打印的地址，检查：

1. 状态栏有「Browser」，点开面板，地址栏输入 `example.com` 回车：画面出现 Example Domain。
2. 点页面上的链接，画面跳转；滚轮能滚；「←」回到上一页；「↻」刷新。
3. 地址栏输入 `http://127.0.0.1:<端口>/`：出现 `only http(s) pages (not tah itself)…` 的提示。
4. 输入框里点一下，用中文输入法打「你好」，再按 Backspace、Enter：页面输入框里文字正确。
5. 「⏻」关闭浏览器后面板显示 `Enter a URL above to open the browser`；`pgrep -fl "$SMOKE/home"` 没有残留 Chrome。
6. 窗口宽度拖到 900px 以下，面板盖在消息流上。

（HTML 预览的「Open in browser」和对话链接要靠 Agent 产生内容，留给 Task 7 的验收。）

用完 Ctrl+C 停掉，`rm -rf "$SMOKE"`。

- [ ] **Step 10: 提交**

按 code-commit 技能提交 `packages/web/src/components/SidePanel.tsx`、`BrowserPane.tsx`、`FilePreview.tsx`、`Messages.tsx`、`StatusBar.tsx`、`ApprovalCard.tsx`、`packages/web/src/App.tsx`、`packages/web/src/styles.css`。参考信息：`feat(web): 浏览器面板：看 Agent 操作、点击输入接手、对话链接在面板打开`。

---

### Task 7: 文档、回归、验收

**Files:**
- Modify: `docs/design/browser.md`
- Modify: `docs/design/serve.md`
- Modify: `docs/design/browser-pane.md`（状态行）
- Modify: `CHANGELOG.md`
- Modify: `docs/guide/roadmap.md`

- [ ] **Step 1: `docs/design/browser.md`**

1. 状态行之后加一行：`v0.36 起 \`tah serve\` 不再弹出 Chrome 窗口，画面在网页的[浏览器面板](./browser-pane.md)里。`
2. 「目标」里 `- \`tah serve\` / \`tah chat\` 弹出可见的 Chrome 窗口，用户能看着它操作；\`tah run\` 用无界面模式。` 改为 `- \`tah chat\` 弹出可见的 Chrome 窗口；\`tah serve\` 在浏览器面板里显示画面（v0.36）；\`tah run\` 用无界面模式。`
3. 「入口工具」里 `- 第一次打开且没给 \`url\` 时导航到 \`about:blank\`，让窗口立刻出现（Playwright MCP 在第一次工具调用时才启动 Chrome）。` 改为 `- 启动时先调一次 \`browser_tabs\`（\`action: "list"\`），让 Chrome 立刻启动（Playwright MCP 在第一次工具调用时才启动 Chrome）；没给 \`url\` 就停在当前页面。`
4. 启动参数表：`--headless` 行改为 `| \`--headless\` | \`tah run\` 和 \`tah serve\`；只有 \`tah chat\`（含 \`--plain\`）弹出窗口 |`；表末加三行：

```markdown
| `--config` | `~/.tah/browser-config.json`：Chrome 加 `--remote-debugging-port=0`，给浏览器面板用（v0.36） |
| `--idle-timeout` | `0`：无界面时不因空闲关浏览器（用户可能只在面板里浏览） |
| `--viewport-size` | `1280x720` |
```

5. 「三、审批」表 `browser_open` 行改为 `| \`browser_open\` | Agent 还没接入时需要审批（用户先在浏览器面板里打开了浏览器也一样）；接入后自动放行 |`；实现那段 `先判断「是 \`browser_open\` 且浏览器已开」就直接返回 \`yes\`` 改为 `先判断「是 \`browser_open\` 且 Agent 已接入（\`agentAttached()\`）」就直接返回 \`yes\``。

- [ ] **Step 2: `docs/design/serve.md`**

文件预览那段（`文件预览（v0.35）：…`）之后加一段：

```markdown
浏览器面板（v0.36）：`GET /api/browser` 返回 `BrowserState`；`GET /api/browser/stream` 是 SSE（`state` 和截屏 `frame`）；`POST /api/browser/open`（`{ url? }`）、`/nav`（`{ action: "back" | "reload" }`）、`/tab`（`{ id }`）、`/input`（`BrowserInput`）、`/close`。都要登录；`open` 不接受 tah 自己的地址（`/preview/` 除外）。见 [浏览器面板](./browser-pane.md)。
```

「### 安全」小节末尾加：

```markdown
- 浏览器面板：Chrome 的调试端口只监听 `127.0.0.1`；面板不能打开 tah 自己的地址（`/preview/` 除外），Agent 的浏览器拿不到登录 cookie；用户在面板里的输入不写日志、不进会话。
```

- [ ] **Step 3: `docs/design/browser-pane.md` 状态行**

```markdown
状态：✅ 已实现（v0.36）
```

- [ ] **Step 4: `CHANGELOG.md`**

在 `# Changelog` 之后、`## 0.35.0 — 2026-10-14` 之前加：

```markdown
## Unreleased

Web (`tah serve`): **browser panel** — the built-in browser now shows in a panel on the right instead of a separate Chrome window: watch the agent click and type, or take over yourself (click, scroll, type — including Chinese input methods — e.g. to log in or solve a captcha). It opens when the agent calls `browser_open`, when you click an http(s) link in the conversation (⌘ / Ctrl-click still opens a new tab), from **Open in browser** on an HTML file preview, or from **Browser** in the status bar (type a URL). The panel shares the right side with the file preview (File / Browser switch). Opening the browser yourself does not give the agent its browser tools: its first `browser_open` still asks. The panel cannot open tah's own address (except file previews), so the agent's browser never gets the tah sign-in; what you type goes only to Chrome. `tah serve` runs Chrome headless (Playwright MCP launches it with a random debugging port on 127.0.0.1, `--idle-timeout 0`, a 1280×720 viewport); `tah chat` still shows a window. New endpoints `GET /api/browser`, `GET /api/browser/stream` and `POST /api/browser/{open,nav,tab,input,close}`.
```

- [ ] **Step 5: `docs/guide/roadmap.md`**

1. 阶段表 `| 20 | 文件预览…` 之后加 `| 21 | 浏览器面板：Agent 的浏览器画面放进工作台，用户可看可接手 | ✅ \`v0.36\` |`。
2. `## Phase 20 — 文件预览 ✅（v0.35）` 一节之后加：

```markdown
## Phase 21 — 浏览器面板 ✅（v0.36）

设计见 [浏览器面板](/design/browser-pane)。

交付物：

- `tah serve` 的内置浏览器改为无界面，画面经 CDP 截屏流进右侧面板；点击、滚动、键盘（含中文输入法）转发给 Chrome
- 入口：Agent 调 `browser_open`、对话里的 http(s) 链接、HTML 文件预览「Open in browser」、状态栏「Browser」
- 用户先打开浏览器不等于授权 Agent；面板不能打开 tah 自己的地址；新接口 `/api/browser*`
```

3. `（当前开发分支 \`v0.35\`）` 改为 `（当前开发分支 \`v0.36\`）`。

- [ ] **Step 6: 文档构建、全量回归**

Run：`pnpm docs:build && pnpm -r build && pnpm test && pnpm typecheck`
Expected：全部成功。

- [ ] **Step 7: 确认没动不该动的包**

Run：`git diff --stat 957a82a HEAD -- packages/core packages/agent packages/tools packages/llm packages/mcp packages/permissions packages/storage packages/scheduler apps/desktop`
Expected：无输出。

Run：`rg -n -i electron packages --glob '!**/node_modules/**' --glob '!**/dist/**'`
Expected：无新增命中（和 `957a82a` 时一致）。

- [ ] **Step 8: 请用户验收（网页和客户端各一次，用真实模型）**

清单发给用户：

1. 状态栏「Browser」打开 `https://example.com`，点击链接、滚动、在搜索框输入中文。
2. 让 Agent 打开一个网页：审批弹出，批准后面板自动出现，能看到它操作，工具栏显示「Agent is using the browser」。
3. 在面板里点一下页面，再让 Agent 描述页面，它看到了变化。
4. 对话里点一个 `http://localhost:<开发服务器>` 链接，在面板打开；⌘ 点击则开新标签页。
5. HTML 文件预览「Open in browser」，Agent 能看到这个页面。
6. 在面板地址栏输入 tah 自己的地址，被拒绝。
7. 先在面板里打开浏览器，再让 Agent 用浏览器：仍然弹审批。

macOS 客户端用真实 `~/.tah`，由用户自己打包（`pnpm --filter desktop dist`）后验。

等用户反馈，有失败项回到对应任务修。

- [ ] **Step 9: 提交**

按 code-commit 技能提交 `docs/design/browser.md`、`docs/design/serve.md`、`docs/design/browser-pane.md`、`CHANGELOG.md`、`docs/guide/roadmap.md`。参考信息：`docs: 浏览器面板已实现，补设计说明、更新日志和路线图`。
