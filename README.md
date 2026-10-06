# typescript-agent-harness

English | [中文](./README.zh-CN.md)

**Docs:** [MichaelVendor.github.io/typescript-agent-harness](https://MichaelVendor.github.io/typescript-agent-harness/) · local: `pnpm docs:dev`

TypeScript **Agent Runtime** — inspired by DeepSeek Harness's core idea:

> **Everything is a capability.**

Not an Agent SDK that stuffs LLM / tools / memory into one `Agent` class.
A Runtime that mounts capabilities as plugins, wires them through a shared Context, and observes them through an Event Bus.

```
Application (Coding / Research / Personal Agent)
        │
  Agent Runtime
        │
 ┌──────┼──────┐
 │      │      │
Agent  Plugin  EventBus
 │      │      │
 └──────┼──────┘
        │
   LLM / Tools / Storage  (all plugins)
```

## v0.14 (current)

Runtime through CLI. Capabilities are plugins:

```ts
const runtime = new Runtime();

runtime.use(llmPlugin({ provider: "mock" }));
runtime.use(toolsPlugin({ tools: [listFilesTool(process.cwd())] }));
runtime.use(agentPlugin());

await runtime.start();

const session = await runtime.get(SESSION).create();
await session.run("列出当前目录并总结");
```

```sh
pnpm install
pnpm build
pnpm tah -- run --mock "列出当前目录并说明这个项目"
pnpm tah -- chat
```

`pnpm dev` still runs [`examples/basic-agent`](examples/basic-agent). DeepSeek: copy [`examples/basic-agent/.env.example`](examples/basic-agent/.env.example) to `.env` in that folder.

Other demos: `pnpm demo:runtime` · `pnpm demo:resume` · `pnpm demo:multi`

## Quick start

```sh
pnpm install
pnpm build
pnpm tah -- run --mock "列出当前目录"
```

### Documentation site

```sh
pnpm docs:dev      # VitePress → http://localhost:5173
pnpm docs:build
pnpm docs:preview
```

Pushing to `main` deploys docs via GitHub Actions → GitHub Pages. Enable **Settings → Pages → Source: GitHub Actions** once. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Layout

```
packages/
  core/     Runtime / Plugin / Context / Service / EventBus
  llm/      mock + OpenAI-compatible
  tools/        registry + list/read/write/exec + permission gate
  agent/        Session + DefaultLoop + resume + subagent tool
  storage/      SQLite event log + checkpoints
  permissions/  allow / deny
  mcp/          MCP backend → Tool (in-process ping + stdio)
  scheduler/    once / every
  cli/          tah run / tah chat
examples/
  basic-runtime/  Phase 1 smoke
  basic-agent/    Phase 2 tool-use loop
  resume-agent/   Phase 3 crash + resume
  multi-agent/    Phase 4 permissions + MCP + scheduler
```

## Roadmap

| Phase | Scope |
| --- | --- |
| **1** | Runtime skeleton |
| **2** | LLM + Tools + Agent Loop + Session |
| **3** | SQLite persistence, checkpoint / resume |
| **4** | MCP, scheduler, subagent-as-tool, permissions |
| **5** | CLI `tah run` / `tah chat` (no Web/TUI) |
| **6** | Tests + CI + stdio MCP (current) |

## Documentation

- **Site:** https://MichaelVendor.github.io/typescript-agent-harness/
- **Source:** [`docs/`](./docs/) (VitePress, Chinese)

Start here: [Getting started](./docs/guide/getting-started.md) · [CLI](./docs/guide/cli.md) · [Philosophy](./docs/guide/philosophy.md) · [Architecture](./docs/guide/architecture.md)

## Core philosophy

Plugins do not import each other. They only talk through Context:

```ts
// LLM plugin
ctx.provide(LLM, impl);

// Agent plugin
const llm = ctx.get(LLM);

// Trace plugin
ctx.on("llm.response", (e) => { /* ... */ });
```

That is what keeps Agent from becoming a junk drawer.
