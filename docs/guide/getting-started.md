# 快速开始

## 环境要求

- Node.js ≥ 22（SQLite 用 `node:sqlite`）
- 跑 CLI 不需要 clone；改框架才需要 [pnpm](https://pnpm.io) ≥ 10

## 用 CLI 跑一轮（推荐）

```sh
npx @typescript-agent-harness/cli --help
npx @typescript-agent-harness/cli run --mock "列出当前目录并说明这个项目"
npx @typescript-agent-harness/cli chat
```

全局安装：

```sh
npm install -g @typescript-agent-harness/cli
tah --help
tah run --mock "列出当前目录并说明这个项目"
```

找不到 `tah` 时把 `$(npm prefix -g)/bin` 加入 `PATH`。不要 `sudo npm`。

不加 `--mock` 且存在 `DEEPSEEK_API_KEY`（`<cwd>/.env`）时走 DeepSeek。

详见 [CLI](/guide/cli)。

## 从源码开发

```sh
git clone https://github.com/MichaelVendor/typescript-agent-harness.git typescript-agent-harness
cd typescript-agent-harness
pnpm install
pnpm build
pnpm test
pnpm tah -- run --mock "列出当前目录并说明这个项目"
```

## 分 Phase 的演示

| 命令 | 内容 |
| --- | --- |
| `pnpm demo:runtime` | Phase 1：插件启停 |
| `pnpm dev` | Phase 2：`session.run` + 工具 |
| `pnpm demo:resume` | Phase 3：崩溃后续跑 |
| `pnpm demo:multi` | Phase 4：权限 / MCP ping / 子 agent / 调度 |

`pnpm dev` 默认 mock。接 DeepSeek：

```sh
cd examples/basic-agent
cp .env.example .env
# 填 DEEPSEEK_API_KEY=sk-...
cd ../..
pnpm dev
```

或：

```sh
DEEPSEEK_API_KEY=sk-... pnpm dev
```

## 最小 Runtime 代码

```ts
import { Runtime, createServiceKey, type Plugin } from "@typescript-agent-harness/core";

const GREETER = createServiceKey<{ greet(name: string): string }>("demo.greeter");

const greeterPlugin: Plugin = {
  name: "greeter",
  setup(ctx) {
    ctx.provide(GREETER, {
      greet: (name) => `Hello, ${name}!`,
    });
  },
};

const runtime = new Runtime();
runtime.use(greeterPlugin);
await runtime.start();

console.log(runtime.get(GREETER).greet("Agent Runtime"));
await runtime.stop();
```

## 本地文档站

```sh
pnpm docs:dev      # http://localhost:5173
pnpm docs:build
pnpm docs:preview
```

## 下一步

- [设计哲学](/guide/philosophy)
- [Runtime](/guide/runtime)
- [CLI](/guide/cli)
- [路线图](/guide/roadmap)
