# 快速开始

## 环境要求

- Node.js ≥ 22（SQLite 用 `node:sqlite`）
- 跑 CLI 不需要 clone；改框架才需要 [pnpm](https://pnpm.io) ≥ 10

## 用 CLI 跑一轮（推荐）

```sh
npx @typescript-agent-harness/cli --help
npx @typescript-agent-harness/cli run --mock "列出当前目录并说明这个项目"
npx @typescript-agent-harness/cli --mock chat
```

全局安装：

```sh
npm install -g @typescript-agent-harness/cli
tah --help
tah run --mock "列出当前目录并说明这个项目"
```

找不到 `tah` 时把 `$(npm prefix -g)/bin` 加入 `PATH`。不要 `sudo npm`。

不加 `--mock` 时需要 `DEEPSEEK_API_KEY`（`<cwd>/.env`），否则退出码 1。有 key 时走 DeepSeek。`--mock` 的「说明项目」是套话，测语义不要加 `--mock`。

默认带 `execute_command` 和 SQLite 持久化，`tah chat` 会续上一次会话；关掉用 `--no-exec` / `--no-persist`。写文件、跑命令前会先问你（允许一次 / 总是允许 / 拒绝），`--yes` 跳过。每轮默认不限步数（Ctrl+C 停，`--max-steps` 设上限）；长会话自动裁剪上下文；`--system-file` 换角色。

在终端里 `tah chat` 是交互界面（TUI）；想在浏览器里用，跑 `tah serve`（只监听本机）：

```sh
tah serve --mock    # 打开 http://127.0.0.1:7420/?token=…
```

详见 [CLI](/guide/cli)。踩坑对照：[版本踩坑与改动](/guide/lessons)。

## 做自己的 Agent

不用写启动代码：`AGENTS.md` 写人设，`tools/` 里一个文件一个工具。

```sh
mkdir my-agent && cd my-agent
npx @typescript-agent-harness/cli init   # 生成文件并装依赖
npx tah --mock chat
```

```ts
// tools/query-order.ts → 工具 query_order
import { defineTool } from "@typescript-agent-harness/cli";

export default defineTool({
  description: "按订单号查询订单状态",
  inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
  async execute(input: { orderId: string }) {
    return { id: input.orderId, status: "shipped" };
  },
});
```

`tah chat` / `tah serve` 运行中改 `AGENTS.md`、`tools/`、`plugins/`、`lib/`，保存后自动重新加载，对话不断（v0.26）。

规则（何时生效、内置工具、插件、热更新、报错）见 [CLI · 约定式项目](/guide/cli)；完整示例 `pnpm demo:convention`。从零做到上线的完整过程见 [教程：做一个文档问答 Agent](/guide/tutorial-docs-agent)。

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

- [教程：做一个文档问答 Agent](/guide/tutorial-docs-agent)
- [设计哲学](/guide/philosophy)
- [Runtime](/guide/runtime)
- [CLI](/guide/cli)
- [路线图](/guide/roadmap)
