# typescript-agent-harness

[English](./README.md) | 中文

**文档站：** [MichaelVendor.github.io/typescript-agent-harness](https://MichaelVendor.github.io/typescript-agent-harness/) · 本地：`pnpm docs:dev`

TypeScript **Agent Runtime** —— 设计思路接近 DeepSeek Harness 的核心理念：

> **Everything is a capability.（一切皆能力）**

这不是把 LLM / tools / memory 塞进一个 `Agent` 类的 Agent SDK。
而是一个 Runtime：用插件挂载能力，通过共享 Context 接线，再用 Event Bus 观察执行过程。

```
Application（Coding / Research / Personal Agent）
        │
  Agent Runtime
        │
 ┌──────┼──────┐
 │      │      │
Agent  Plugin  EventBus
 │      │      │
 └──────┼──────┘
        │
   LLM / Tools / Storage  （全部是插件）
```

## v0.21（当前）

从 Runtime 到 CLI。先用 npm：

```sh
npx @typescript-agent-harness/cli --help
npx @typescript-agent-harness/cli run --mock "列出当前目录并说明这个项目"
npx @typescript-agent-harness/cli --mock chat
```

全局安装后命令是 `tah`：

```sh
npm install -g @typescript-agent-harness/cli
tah --help
tah run --mock "列出当前目录并说明这个项目"
```

找不到 `tah` 时，把 `$(npm prefix -g)/bin` 加进 `PATH`。不要用 `sudo npm`。

能力仍然是插件：

```ts
const runtime = new Runtime();

runtime.use(llmPlugin({ provider: "mock" }));
runtime.use(toolsPlugin({ tools: [listFilesTool(process.cwd())] }));
runtime.use(agentPlugin());

await runtime.start();

const session = await runtime.get(SESSION).create();
await session.run("列出当前目录并总结");
```

从源码（演示和文档站）：

```sh
pnpm install
pnpm build
pnpm tah -- run --mock "列出当前目录并说明这个项目"
pnpm tah -- --mock chat
```

`pnpm dev` 仍跑 [`examples/basic-agent`](examples/basic-agent)。接 DeepSeek：复制 [`examples/basic-agent/.env.example`](examples/basic-agent/.env.example) 为同目录 `.env`。

其它演示：`pnpm demo:runtime` · `pnpm demo:resume` · `pnpm demo:multi`

## 快速开始

```sh
npx @typescript-agent-harness/cli run --mock "列出当前目录"
tah run --mock "列出当前目录"
```

需要 Node.js ≥ 22。仓库内：`pnpm install && pnpm build && pnpm tah -- run --mock "列出当前目录"`

### 文档站

```sh
pnpm docs:dev      # VitePress → http://localhost:5173
pnpm docs:build
pnpm docs:preview
```

推送到 `main` 后由 GitHub Actions 部署到 GitHub Pages。仓库需开启一次 **Settings → Pages → Source: GitHub Actions**。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 目录结构

```
packages/
  core/     Runtime / Plugin / Context / Service / EventBus
  llm/      mock + OpenAI-compatible
  tools/        registry + list/read/write/exec + 权限闸门
  agent/        Session + DefaultLoop + resume + 子 agent tool
  storage/      SQLite 事件日志 + checkpoint
  permissions/  allow / deny
  mcp/          MCP backend → Tool（ping + stdio）
  scheduler/    once / every
  cli/          tah run / tah chat
examples/
  basic-runtime/  Phase 1 冒烟
  basic-agent/    Phase 2 tool-use
  resume-agent/   Phase 3 崩溃后续跑
  multi-agent/    Phase 4 权限 + MCP + 调度
```

## 路线图

| Phase | 范围 |
| --- | --- |
| **1** | Runtime 骨架 |
| **2** | LLM + Tools + Agent Loop + Session |
| **3** | SQLite 持久化、checkpoint / resume |
| **4** | MCP、scheduler、子 agent、权限 |
| **5** | CLI `tah run` / `tah chat`（无 Web/TUI） |
| **6** | 测试 + CI + stdio MCP（当前） |

## 文档

- **在线文档：** https://MichaelVendor.github.io/typescript-agent-harness/
- **源码目录：** [`docs/`](./docs/)（VitePress）

常用入口：[快速开始](./docs/guide/getting-started.md) · [CLI](./docs/guide/cli.md) · [设计哲学](./docs/guide/philosophy.md) · [整体架构](./docs/guide/architecture.md)

## 核心哲学

插件之间不互相 import，只通过 Context 通信：

```ts
// LLM plugin
ctx.provide(LLM, impl);

// Agent plugin
const llm = ctx.get(LLM);

// Trace plugin
ctx.on("llm.response", (e) => { /* ... */ });
```

这样 Agent 才不会最终变成垃圾场。
