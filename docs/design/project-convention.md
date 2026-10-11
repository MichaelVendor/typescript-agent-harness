# 设计说明：约定式项目开发（v0.23）

状态：✅ 已实现（`v0.23`）；用法见 [CLI · 约定式项目](../guide/cli.md)

## 背景

现在要基于 tah 做自己的 Agent，只有两条路：

1. `tah --system-file role.md`：只能换提示词，不能加工具。
2. 自己写 `main.ts`，手动 `runtime.use(...)` 组装全部插件：灵活，但要重写 CLI 已经做好的部分（流式输出、审批、会话续接、SQLite、`/resume` 等）。

中间缺一档：**用 `tah` 现成的命令行体验，只补自己的提示词和工具**。DeepSeek Harness（`dsh`）的做法是写插件文件、在 `cordis.yml` 里登记、`dsh web --patch` 启动，并自动读取 `AGENTS.md`。本设计借鉴「约定文件 + 自动加载」，并进一步去掉登记这一步：**文件放对目录就生效**。

## 目标

在一个目录里按约定放文件，运行 `tah chat` / `tah run` 就能得到带自定义角色、工具和插件的 Agent，不需要写启动代码，也不需要配置文件。

```
my-agent/
├── AGENTS.md              # 角色和规则，替换内置的「coding agent」人设
├── tools/                 # 一个文件 = 一个工具，自动加载
│   ├── query-order.ts     # → 工具 query_order
│   └── refund.ts          # → 工具 refund
├── plugins/               # 一个文件 = 一个插件，自动加载（可选）
│   └── audit-log.ts       # → 插件 project:audit-log
├── lib/                   # 共用代码，不自动加载
│   └── api-client.ts
├── .env                   # DEEPSEEK_API_KEY=...（已有约定）
└── package.json           # 依赖 @typescript-agent-harness/cli = 项目模式开关
```

## 非目标

- 约定文件不替代官方能力开关：角色与自定义工具仍用 `AGENTS.md` / `tools/` / `plugins/`；官方能力包与扩展见项目根目录 [`tah.config.json`](./config.md)（v0.28：`capabilities.coding` / `vision` 等；`extensions.mcp` 接第三方 MCP。`capabilities.web` 预留未实现，上网用 MCP）。模型、权限细粒度、步数仍走命令行参数和 `.env`。
- 不做 profile、bundle、多层配置叠加（`dsh` 有，tah 不需要）；不做用户级 `~/.tah/config`（见 config 设计非目标）。
- 不做 `tah plugin add` 之类的安装命令；第三方能力就是 npm 依赖，在 `plugins/` 里引入。
- 不做 Web UI（本机 `tah serve` 另见 serve 设计）。
- 不改 `core` / `agent` / `tools` 等包，改动只在 `packages/cli`。
- `AGENTS.md` 不沿目录向上查找、不支持 `AGENTS.local.md`，只读 `--cwd` 这一层。

## 用户视角

### 1. 初始化项目

```sh
mkdir my-agent && cd my-agent
npx @typescript-agent-harness/cli init
```

`tah init` 生成 `package.json`（依赖 CLI）、`AGENTS.md`、`tools/current-time.ts`、`tah.config.json`（可选能力包示例，v0.28）、`tsconfig.json`、`.env.example`、`.gitignore`，已存在的文件跳过不覆盖；随后自动装依赖（v0.23.1，`--no-install` 跳过；在别的 pnpm 工作区里用 `pnpm install --ignore-workspace`）。本地安装 CLI 既是项目模式的开关，也提供 `defineTool` / `definePlugin` 和类型；运行用 `npx tah chat`。全局装的 `tah` 在同一目录下也会读取同样的约定文件。

### 2. 写工具

```ts
// tools/query-order.ts
import { defineTool } from "@typescript-agent-harness/cli";
import { api } from "../lib/api-client.ts";

export default defineTool({
  description: "按订单号查询订单状态",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"],
    additionalProperties: false,
  },
  async execute(input: { orderId: string }, ctx) {
    return api.get(`/orders/${input.orderId}`, { signal: ctx.signal });
  },
});
```

不写 `name`，工具名由文件名得到：`query-order.ts` → `query_order`。

### 3. 写插件（可选）

需要监听事件、按条件注册工具、提供服务时才用：

```ts
// plugins/audit-log.ts
import { definePlugin } from "@typescript-agent-harness/cli";

export default definePlugin({
  setup(ctx) {
    ctx.on("tool.finished", (e) => console.log("[audit]", e));
  },
});
```

### 4. 写项目说明

```md
<!-- AGENTS.md -->
你是售后客服助手。查订单必须调用 query_order，不要猜测物流状态。
```

### 5. 运行

```sh
npx tah chat
```

启动行会多出 `project: AGENTS.md tools+2 plugins+1`，表示约定文件已生效。

## 约定细则

### 何时进入项目模式

只有 `--cwd` 的 `package.json` 在 `dependencies` 或 `devDependencies` 里有 `@typescript-agent-harness/cli` 时，才加载 `AGENTS.md`、`tools/`、`plugins/`。

原因：很多普通代码仓库本来就有 `tools/`、`plugins/` 目录（放脚本），也越来越多地带 `AGENTS.md`。如果见目录就加载，`tah chat` 会在任意仓库里 import——也就是执行——这些脚本。用依赖声明做开关，既不需要额外的配置文件，又保证没有这条依赖的目录行为与 v0.22 完全一致。

### 扫描哪些文件

| 规则 | 说明 |
| --- | --- |
| 根目录 | `--cwd`（默认当前目录），且满足上面的项目模式条件 |
| 扫描目录 | `tools/`、`plugins/`，目录不存在就跳过 |
| 只扫第一层 | 子目录不扫描，可放该目录专用的辅助代码 |
| 文件类型 | `.ts`、`.mts`、`.js`、`.mjs` |
| 跳过 | `_` 开头的文件、`.d.ts`、`*.test.*`、`*.spec.*` |
| 加载顺序 | 按文件名字典序；插件间有依赖时用 `01-`、`02-` 前缀控制 |
| 哪些命令加载 | `tah run`、`tah chat`；`tah sessions` / `help` / `version` 不加载 |

### 名字推导

| 来源 | 规则 | 例子 |
| --- | --- | --- |
| 工具名 | 去掉扩展名，`-` 换成 `_` | `query-order.ts` → `query_order` |
| 插件名 | 去掉扩展名，加 `project:` 前缀 | `audit-log.ts` → `project:audit-log` |

- 推导出的工具名必须匹配 `^[a-z][a-z0-9_]*$`（模型 function-calling 能接受的形式），否则启动报错，提示改文件名。
- `defineTool({ name })` / `definePlugin({ name })` 显式写了就以它为准，用于少数必须和文件名不同的情况。
- 插件名带 `project:` 前缀，避免和内置插件（`llm`、`tools`、`agent` 等）撞名。

### 文件导出

| 目录 | 默认导出 |
| --- | --- |
| `tools/` | `defineTool({...})` 的返回值，即缺省 `name` 的 `Tool` 对象 |
| `plugins/` | `definePlugin({...})` 的返回值，即缺省 `name` 的 `Plugin` 对象 |

`defineTool` / `definePlugin` 只是带类型的恒等函数，便于推断 `execute` 的参数类型；直接导出同形状的普通对象也可以。没有默认导出或形状不对时启动报错。

### 系统提示词拼接

`AGENTS.md` 占据「人设」那一段，替换内置的 `You are a workspace coding agent.`：

```
<人设：--system-file > AGENTS.md > 默认角色>

<内置工具规则：仅在挂了内置工具时>
```

- 只取一个人设，避免两个角色同时出现在提示词里互相打架。
- 命令行 `--system-file` 优先于 `AGENTS.md`，方便临时试别的人设；此时启动行显示 `AGENTS.md (overridden by --system-file)`。
- 实现上把 `AGENTS.md` 当作默认的 `--system-file`，复用 `buildSystemPrompt({ role })`。

### 内置工具

有 `tools/` 目录时，内置的 `list_files` / `read_file` / `grep` / `write_file` / `execute_command` 默认不挂，提示词里的对应规则也去掉，模型只看到项目自己的工具；没有 `AGENTS.md` 时默认角色换成通用的 `You are a helpful agent…`。`--builtin-tools` 或 `tah.config.json` 里 `"capabilities": { "coding": true }` 恢复内置工具和规则。

只有 `AGENTS.md`、没有 `tools/` 时，内置工具照常挂上（典型场景：给代码仓库换个人设）。

### 插件注册顺序

```
storage → permissions → approval → llm → tools(内置 + tools/) → mcp → agent → scheduler → plugins/
```

项目插件放最后，所以 setup 时所有内置服务都已就绪。Agent 每次调用模型都会重新读取工具列表，所以插件在 setup 里 `TOOLS.register(...)` 的工具也会被模型看到——条件加载、带参数的工具都用这种方式实现。

### 与用户项目里的框架包共存

插件里要用 `LLM`、`TOOLS`、`SESSION` 等服务键时，用户需要另装对应包（如 `@typescript-agent-harness/tools`），版本可能和 CLI 自带的不同。这不影响协作：

- 工具是普通对象，没有类实例判断。
- 服务按字符串 id 匹配（`createServiceKey` 返回 `{ id }`），用户包里的 `TOOLS` 能取到 CLI 提供的服务。

### 运行 TypeScript

用户写的是 `.ts`，CLI 是编译后的 `.js`。所有约定文件统一用 [jiti](https://github.com/unjs/jiti) 加载，包括它们导入的本地 `.ts`（含 `lib/`），用户无需编译。jiti 以项目的 `package.json` 为基准解析依赖，所以 `import { defineTool } from "@typescript-agent-harness/cli"` 取的是项目自己装的那份。

### 错误处理

所有错误都在启动时报出，打印文件路径，退出码 1。

| 情况 | 报错 |
| --- | --- |
| 文件语法错误、导入失败 | `tah: failed to load tools/query-order.ts: <原因>` |
| 没有默认导出 / 形状不对 | `tah: tools/foo.ts must export default defineTool({...})` |
| 文件名推导不出合法工具名 | `tah: tools/查询.ts: tool name "查询" is invalid; rename the file or set name` |
| 工具与内置工具重名（仅 `--builtin-tools` 时） | `tah: tools/read-file.ts: tool "read_file" is built in` |
| 项目工具彼此重名 | `tah: tools/a-b.ts and tools/a_b.ts both define tool "a_b"` |

### 审批

v0.22 起 `write_file` / `execute_command` 执行前会询问 `[y/n/a]`。自定义工具在 v0.23 **不询问**；以后有需要再考虑 `defineTool({ approve: true })`。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/cli/src/project.ts`（新） | 项目模式判断，扫描 `tools/`、`plugins/`，推导名字，加载校验，读取 `AGENTS.md` |
| `packages/cli/src/init.ts`（新） | `tah init` 骨架 |
| `packages/cli/src/index.ts`（新） | 导出 `defineTool`、`definePlugin`，转导出 `Tool`、`ToolContext`、`Plugin`、`Context` 类型 |
| `packages/cli/src/runtime.ts` | `bootRuntime` 加载项目、按需去掉内置工具、末尾注册项目插件、启动行显示加载结果 |
| `packages/cli/src/prompt.ts` | `builtinTools: false` 时只输出人设 |
| `packages/cli/src/args.ts`、`cli.ts` | `--builtin-tools`、`init` 命令、项目错误不打印堆栈 |
| `packages/cli/package.json` | `main` / `exports` 指向 `dist/index.js`，`bin` 不变；新增依赖 `jiti` |
| `packages/cli/test/project.test.ts`（新） | 见下方测试 |
| `docs/guide/cli.md`、`CHANGELOG.md` | 用法说明 |
| `examples/convention-agent/`（新） | 售后客服示例：`AGENTS.md`、`tools/query-order.ts`、`lib/orders.ts`、`plugins/audit-log.ts`；`pnpm demo:convention` |

## 测试

- `package.json` 没有 CLI 依赖：`tools/`、`AGENTS.md` 都被忽略，`tools/` 里的文件不会被执行。
- 只有 `AGENTS.md`：它替换内置人设，提示词里不再出现 `workspace coding agent`，工具规则仍在。
- 同时有 `AGENTS.md` 和 `--system-file`：用 `--system-file`。
- 有 `tools/`：只挂项目工具，提示词里没有内置工具规则；`--builtin-tools` 恢复。
- `tools/greet.ts` 从 CLI 包导入 `defineTool`、导入 `../lib/greet.ts`：工具名为 `greet`，能执行。
- `tools/echo-text.ts`：以 `echo_text` 出现在 `TOOLS.list()`，`--mock` 下能被调用。
- 显式 `name` 覆盖文件名推导。
- `.mjs` 工具同样生效。
- `_helper.ts`、`foo.test.ts`、子目录里的文件不被加载。
- 插件按文件名顺序注册；setup 里 `ctx.get(TOOLS).register(...)` 的工具对模型可见。
- 上面「错误处理」表里每一种情况：抛出 `ProjectError`，报错包含文件路径。
- `tah init`：生成骨架，已存在的文件不覆盖。

## 已定决策

| 问题 | 决定 |
| --- | --- |
| 配置方式 | 约定目录管角色/自定义工具；官方能力用根目录 `tah.config.json`（见 [项目配置](./config.md)，v0.28）；不做 TS/YAML config |
| 工具名 | 由文件名推导，`name` 可覆盖 |
| `AGENTS.md` | 替换人设，`--system-file` 优先 |
| 项目模式开关 | `package.json` 依赖 CLI |
| 内置工具 | 有 `tools/` 时默认不挂，`--builtin-tools` 恢复 |
| TypeScript | 引入 `jiti`，所有约定文件都走它 |
| 自定义工具审批 | v0.23 不做 |
| `tah init` | 做 |
| 分支 | `main` 快进到 `v0.22`，在 `v0.23` 开发 |
