# typescript-agent-harness

[English](./README.md) | 中文

**文档站：** https://MichaelVendor.github.io/typescript-agent-harness/ · 本地：`pnpm docs:dev`

TypeScript **Agent Runtime / SDK** —— 按约定搭你自己的 Agent。

> **Everything is a capability.（一切皆能力）**

## 搭建 Agent（从这里开始）

不用写启动代码：`AGENTS.md` 写人设，`tools/` 里一个文件一个工具，`skills/*/SKILL.md` 一个文件一个技能。

```sh
mkdir my-agent && cd my-agent
npx @typescript-agent-harness/cli init
npx tah --mock chat
```

然后：改 `AGENTS.md` → 加 `tools/*.ts`（`defineTool`）→ 可选 `skills/*/SKILL.md` → 继续聊（`/` 调技能）。

**一小时清单：** init 能跑 · 改 tool 保存即生效 · `/hello`（或你的技能）能调 · mock 一轮能证明「这是我的 agent」。

完整说明：[快速开始](./docs/guide/getting-started.md) · [CLI · 约定式项目](./docs/guide/cli.md)

## 嵌入 Runtime

插件只通过 Context 通信（进阶）：

```ts
const runtime = new Runtime();
runtime.use(llmPlugin({ provider: "mock" }));
runtime.use(toolsPlugin({ tools: [listFilesTool(process.cwd())] }));
runtime.use(agentPlugin());
await runtime.start();
const session = await runtime.get(SESSION).create();
await session.run("列出当前目录并总结");
```

见 [设计哲学](./docs/guide/philosophy.md) · [整体架构](./docs/guide/architecture.md) · [API](./docs/api/core.md)

## 高级宿主（可选）

本机 TUI/网页、桌面端、无头 host、内网控制面、Super-agent / IM —— 搭 Agent 不依赖这些：

- `tah chat` / `tah serve` — [CLI](./docs/guide/cli.md)
- 索引：[Hosts（宿主形态）](./docs/guide/hosts.md)

## 安装 / 从源码

```sh
npx @typescript-agent-harness/cli --help
npx @typescript-agent-harness/cli run --mock "列出当前目录并说明这个项目"
```

全局安装后命令是 `tah`：

```sh
npm install -g @typescript-agent-harness/cli
tah --help
tah run --mock "列出当前目录并说明这个项目"
```

找不到 `tah` 时，把 `$(npm prefix -g)/bin` 加进 `PATH`。不要用 `sudo npm`。

需要 Node.js ≥ 22。

从仓库（演示和文档站）：

```sh
pnpm install
pnpm build
pnpm tah -- run --mock "列出当前目录并说明这个项目"
pnpm tah -- --mock chat
```

`pnpm dev` 跑 [`examples/basic-agent`](examples/basic-agent)。接 DeepSeek：复制 [`examples/basic-agent/.env.example`](examples/basic-agent/.env.example) 为同目录 `.env`。

其它演示：`pnpm demo:runtime` · `pnpm demo:resume` · `pnpm demo:multi` · `pnpm demo:convention`

**专家样板（本地体验，分支 `v1.7`）：** clone 仓库 → `git checkout v1.7` → `pnpm install && pnpm build` → 进入其一：

- [`examples/meeting-actions-agent`](examples/meeting-actions-agent) — 纪要→行动项（`pnpm start` / `tah serve`）
- [`examples/weekly-report-agent`](examples/weekly-report-agent) — 杂记→周报
- [`examples/resume-jd-agent`](examples/resume-jd-agent) — 简历×JD

fixture 在各自 `data/fixtures/`；步骤详见 [快速开始 · 专家样板](./docs/guide/getting-started.md)。

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
  tools/    registry + list/read/write/exec + 权限闸门
  agent/    Session + DefaultLoop + resume + 子 agent tool
  storage/  SQLite 事件日志 + checkpoint
  cli/      tah run / tah chat（TUI）/ tah serve / tah init + 约定式项目加载
  web/      tah serve 的网页（React + Vite，随 cli 发布）
examples/
  convention-agent/       AGENTS.md + tools/ + plugins/
  basic-agent/            tool-use 演示
  meeting-actions-agent/  纪要→行动项（专家样板）
  weekly-report-agent/    杂记→周报（专家样板）
  resume-jd-agent/        简历×JD（专家样板）
```

完整包与示例列表见 [生态](./docs/guide/ecosystem.md)。

阶段与计划：[路线图](./docs/guide/roadmap.md)

## 文档

- **在线文档：** https://MichaelVendor.github.io/typescript-agent-harness/
- **源码目录：** [`docs/`](./docs/)（VitePress）

常用入口：[快速开始](./docs/guide/getting-started.md) · [CLI](./docs/guide/cli.md) · [设计哲学](./docs/guide/philosophy.md) · [整体架构](./docs/guide/architecture.md)
