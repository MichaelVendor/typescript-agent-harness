# CLI

状态：✅ Phase 5（`packages/cli`）· v0.21 默认偏向本机 coding · v0.22 写文件/跑命令前先问

LLM 增量文本会写到 stdout（`agent.assistant-stream`），不必等整段 `generate` 结束。

## 命令

```sh
npx @typescript-agent-harness/cli run --mock "列出当前目录并说明这个项目"
npx @typescript-agent-harness/cli --mock chat
```

全局安装：`npm install -g @typescript-agent-harness/cli`，之后直接 `tah …`。仓库内：`pnpm build` 后用 `pnpm tah -- …`。

| 命令 | 作用 |
| --- | --- |
| `tah run <prompt>` | 一次性 Session |
| `tah chat` | 多轮；**默认续上一次持久化 Session**；终端里是 TUI（v0.24），管道或 `--plain` 仍是逐行模式；`/exit` / `/reset` / `/sessions` / `/resume` / `/fork` |
| `tah serve` | 在本机起网页工作台，浏览器里操作当前目录的 Agent（v0.25，见下文「网页工作台」） |
| `tah sessions` | 列出已保存的 Session（最新在前；不需要 API key，v0.22） |
| `tah init` | 在当前目录生成约定式项目骨架并装好依赖（v0.23，见下文「约定式项目」） |
| `tah help` | 用法 |
| `tah version` | 打印 CLI 版本（也可 `--version` / `-v`） |

## 标志

| 标志 | 作用 |
| --- | --- |
| `--cwd <path>` | 工作区（工具的根目录） |
| `--mock` | 本地假模型；没有 API key 时必须加，否则退出码 1 |
| `--persist` | SQLite：`<cwd>/.tah/cli.db`（**默认开**） |
| `--no-persist` | 关掉 SQLite；chat 不会跨 `/exit` 续聊 |
| `--quiet` | 只打印模型回复 |
| `--exec` | 挂上 `execute_command`（**默认开**） |
| `--no-exec` | 关掉 `execute_command` |
| `--yes` / `-y` | 跳过 `write_file` / `execute_command` 的审批 |
| `--max-steps <n>` | 每轮 LLM 上限（**默认不限**，Ctrl+C 停） |
| `--system-file <path>` | 用文件内容替换默认角色「workspace coding agent」（v0.22） |
| `--session <id\|n>` | `tah chat` 续指定 Session，而不是最近一个（v0.22） |
| `--mcp <cmd>` | 挂上 stdio MCP 工具（默认关） |
| `--mcp-arg <a>` | `--mcp` 的额外参数（可重复） |
| `--allow <tool>` | 白名单（可重复；不写则不限制） |
| `--deny <tool>` | 黑名单（可重复；优先于 `--allow`） |
| `--once <ms>` | 延迟后跑一轮 `tah run`（默认关；仅 `run`） |
| `--builtin-tools` | 约定式项目有 `tools/` 时，仍挂上内置的文件 / 命令工具（v0.23） |
| `--no-install` | `tah init` 只生成文件，不装依赖（v0.23.1） |
| `--plain` | `tah chat` 强制逐行模式，即使在终端里也不进 TUI（v0.24） |
| `--port <n>` | `tah serve` 的端口（默认 7420；被占用时报错，不自动换，v0.25） |
| `--no-open` | `tah serve` 不自动打开浏览器（v0.25） |

不加 `--mock` 时必须有 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`（`<cwd>/.env`，以及仓库内 `examples/basic-agent/.env`）。没有 key 不会再静默 mock。

默认一轮跑到模型自己停下为止，中途 Ctrl+C 打断。传了 `--max-steps` 后，走到上限会打印 `finishReason=max_steps`（状态行的 `steps` 是本轮 LLM 次数）；`tah chat` 在终端里会接着问「继续？」，回车就用新的一份额度继续同一轮，`n` 停下。`tah run` 或管道输入时不问，可之后在会话里说「继续」。

管道多轮：

```sh
printf '第一句\n第二句\n' | npx @typescript-agent-harness/cli --mock chat
```

续聊（默认 persist）：

```sh
tah --mock chat          # 聊几句后 /exit
tah --mock chat          # 应看到 resumed session …
```

## 默认挂上的能力

LLM + `list_files` / `read_file` / `grep` / `write_file` + **`execute_command`** + Agent Loop + SQLite。  
MCP / scheduler 仍默认关。

`execute_command` 默认 30 秒超时；装依赖、构建、跑测试这类慢命令，模型会按次传 `timeoutMs`（最长 10 分钟）。`--max-steps` 对续上的旧 Session 同样生效。

```sh
pnpm tah -- --mock run "用 node 打印 1+1"
```

## 审批（v0.22）

`write_file` 和 `execute_command` 每次执行前会弹一张卡片（写文件时预览前 8 行内容），输入字母后回车：

```text
╭─ Run command
│ $ npm test
╰─
  y allow once  ·  a always allow execute_command  ·  n / Enter reject  ›
```

| 回答 | 效果 |
| --- | --- |
| `y` | 只放行这一次 |
| `a` | 本次进程内该工具不再问 |
| 其他 / 回车 | 拒绝；模型收到 `rejected by user`，应改问你怎么办 |

- `--yes` / `-y`：全部放行，不问
- stdin 不是终端（管道、CI）且没加 `--yes`：直接拒绝，避免把管道里的下一行当成回答
- 被 `--deny` 拦下的工具不会弹审批

```sh
printf '把 README 第一行改成 Hello\n' | tah --yes chat   # 脚本里要写文件必须 --yes
```

## 多个 Session：列出、切换、分叉（v0.22）

```sh
tah sessions
#   1  session_31_muyxw3su  completed   2 turns  2026-10-08 10:50  帮我看下 auth 模块…
#   2  session_1_muyxvyp2   completed   3 turns  2026-10-08 10:42  跑一下单测…
tah chat --session 2        # 序号或完整 id
```

chat 里：

| 命令 | 作用 |
| --- | --- |
| `/sessions` | 列出 Session，`*` 是当前这个 |
| `/resume <id\|n>` | 切到另一个 Session |
| `/fork` | 复制当前 Session 到新 Session 并切过去；原 Session 不变（想试另一条路时用） |
| `/fork <n>` | 只保留前 n 轮再分叉（「回到第 n 轮重来」） |

序号随最近更新时间变化，以最近一次 `tah sessions` / `/sessions` 为准。分叉不需要 persist；`--session` / `/resume` 需要（默认开）。

## 自定义角色（v0.22）

```sh
echo "You are a strict code reviewer. Report bugs first, cite file:line. Answer in Chinese." > reviewer.md
tah --system-file reviewer.md chat
```

- 只替换角色那一句；工具使用规则、exec 提示仍会追加在后面
- 续上一次 Session 时同样生效（存下来的旧 system 会被换掉）
- 每次启动都要带上；不带就回到默认 coding 角色

## 约定式项目（v0.23）

不写启动代码，按约定放文件就能做出自己的 Agent：

```sh
mkdir my-agent && cd my-agent
npx @typescript-agent-harness/cli init   # 生成文件并装依赖
npx tah --mock chat
```

`tah init` 生成文件后自动装依赖（v0.23.1）：目录里有 `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` 就用对应的包管理器，否则用启动它的那个（`pnpm dlx` → pnpm），默认 npm。项目放在别的 pnpm 工作区（上层有 `pnpm-workspace.yaml`）里时，用 `pnpm install --ignore-workspace`，否则 pnpm 会去装外层工作区、跳过这个项目。装失败或加了 `--no-install`，会打印要自己跑的命令。

```text
my-agent/
├── AGENTS.md              # 人设和规则，替换默认的 coding agent 角色
├── tools/                 # 一个文件 = 一个工具
│   └── query-order.ts     # → 工具 query_order
├── plugins/               # 一个文件 = 一个插件（可选）
│   └── audit-log.ts       # → 插件 project:audit-log
├── lib/                   # 共用代码，不自动加载
└── package.json           # 依赖 @typescript-agent-harness/cli
```

工具文件：

```ts
// tools/query-order.ts
import { defineTool } from "@typescript-agent-harness/cli";

export default defineTool({
  description: "按订单号查询订单状态",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"],
  },
  async execute(input: { orderId: string }, ctx) {
    return { id: input.orderId, status: "shipped" };
  },
});
```

插件文件：`export default definePlugin({ setup(ctx) { … } })`，可以 `ctx.on(...)` 监听事件、`ctx.get(TOOLS).register(...)` 按条件加工具。

规则：

- **何时生效**：只有 `--cwd`（默认当前目录）的 `package.json` 在 `dependencies` 或 `devDependencies` 里有 `@typescript-agent-harness/cli` 时才算项目。普通代码仓库里的 `tools/`、`plugins/`、`AGENTS.md` 不会被加载。
- **人设**：`AGENTS.md` 替换默认角色；`--system-file` 优先于 `AGENTS.md`。
- **内置工具**：有 `tools/` 目录时，`list_files` / `read_file` / `grep` / `write_file` / `execute_command` 和对应的提示词规则都不挂；加 `--builtin-tools` 恢复。只有 `AGENTS.md` 没有 `tools/` 时，内置工具照常挂上。
- **工具名**：文件名去掉扩展名、`-` 换成 `_`；必须是小写字母开头的 `a-z0-9_`。`defineTool({ name })` 可以覆盖。
- **扫描**：只扫 `tools/`、`plugins/` 第一层的 `.ts` / `.mts` / `.js` / `.mjs`；跳过 `_` 开头、`*.test.*`、`*.spec.*`、`.d.ts` 和子目录。按文件名排序加载，插件间有先后依赖时用 `01-` 前缀。
- **注册顺序**：项目插件在所有内置插件之后注册，setup 时 LLM、Tools、Session 都已可用。
- **TypeScript**：用 [jiti](https://github.com/unjs/jiti) 加载，不用编译；可以 `import "../lib/x.ts"`。
- **出错**：文件加载失败、导出不对、名字不合法、重名，都在启动时报错并给出文件路径，退出码 1。
- **审批**：自定义工具执行前不询问。

启动行会多一行 `[tah] project: AGENTS.md tools+1 plugins+1`。完整示例见 `examples/convention-agent`（`pnpm demo:convention`）。

## 终端 UI（v0.24）

终端里直接 `tah chat` 进入 Ink TUI（内联滚动区，不切备用屏）：流式 Markdown、工具调用行、界面内审批（y / a / n）、斜杠命令补全、会话选择器、多行输入（Alt+Enter 或行尾 `\` 换行，粘贴整段进输入框）。管道、CI、`--plain` 仍是原来的逐行模式。

| 操作 | 行为 |
| --- | --- |
| Enter | 发送 |
| Alt+Enter / Shift+Enter（支持的终端）/ 行尾 `\` + Enter | 换行 |
| `/` | 命令菜单；`/resume` 不带参数打开会话列表 |
| Ctrl+C | 回复中：停本轮；有输入：清空；空闲：退出 |
| Ctrl+D | 空闲且输入为空时退出 |

设计说明见 [TUI 与会话接口](/design/tui)。

## 网页工作台（v0.25）

```sh
tah serve                 # 打开 http://127.0.0.1:7420/?token=…
tah serve --yes --port 8000 --no-open
```

`tah serve` 在本机起服务并打开浏览器，网页里操作的就是当前目录的 Agent：流式 Markdown、工具调用行、审批卡片（允许一次 / 总是允许 / 拒绝）、步数上限的「继续」、会话侧栏（切换 / 新建 / 分叉）、停止当前轮。和 TUI 一样同一时间只有一个当前会话；开多个标签页看到的是同一个会话，操作实时同步，刷新或断线重连后从服务端补齐。`tah chat` 的其他参数（`--yes`、`--max-steps`、`--no-persist`、`--session`、`--mock` …）照常可用。

它是本机工作台，不是对外服务：

- 只监听 `127.0.0.1`。要远程用，走 SSH 端口转发（`ssh -L 7420:127.0.0.1:7420 …`）。
- 每次启动生成一次性令牌，只有终端打印的链接能登录；网页拿令牌换成 HttpOnly cookie 后从地址栏去掉令牌。
- 校验 `Host` / `Origin` 头，挡住其他网页伪造请求。

Ctrl+C 停止服务并打印续聊命令（`tah chat --session …`），再按一次强制退出。

改网页时：先 `tah serve --no-open`，再在 `packages/web` 里 `pnpm dev`，Vite 把 `/api` 代理到 `127.0.0.1:7420`；打开 Vite 的地址并带上终端里的 `?token=…`。

设计说明见 [tah serve 与网页工作台](/design/serve)。

## Ctrl+C 与失败重试（v0.22）

| 场景 | 行为 |
| --- | --- |
| `tah chat`（TUI）正在跑一轮（含等审批） | 中断这一轮；历史保留 |
| `tah chat`（TUI）空闲 | 有输入则清空，否则退出（同 `/exit`） |
| `tah chat --plain` 正在跑一轮 | 中断这一轮，回到 `you>`；历史保留 |
| `tah chat --plain` 空闲在 `you>` | 退出（同 `/exit`） |
| `tah run` | 直接退出 |
| 模型接口网络错误 / 429 / 5xx | 自动重试 3 次（1s、2s、4s），打印 `[llm] … retry N in Xs` |
| 重试仍失败 | chat 打印失败提示并继续可聊，不退出 |

模型在调用工具前说的话（如「我先读一下文件」）会单独成行，和后面的 `[tool]` 日志分开；最终回答若复述了过程，那是模型行为，不是重复打印。

## 输出样式

在终端里，模型回复的 Markdown 用 [marked-terminal](https://github.com/mikaelbr/marked-terminal) 的默认样式渲染（标题、粗体、行内代码、列表、带边框的表格、代码块语法高亮）；`[tah]` / `[llm]` / `[tool]` / `[ctx]` 日志变灰；审批卡片用黄色边框。

- 按 Markdown 块显示：一段文字、一个列表、一张表或一个代码块收完才出现（不再逐字出现）
- 输出不是终端（管道、重定向）、设置了 `NO_COLOR`、或 `TERM=dumb` 时，原样输出纯文本

## 长会话上下文（v0.22）

每次请求最多发约 100,000 字符（约 25k token 的英文/代码；中文更费）。超了会打印：

```text
[ctx] trimmed: 2 old turn(s) dropped, 5 tool output(s) omitted, 98712 chars sent (full history kept; /reset for a fresh session)
```

先省略旧的工具输出，再整轮丢最早的对话；当前这一轮始终完整。SQLite 里的完整历史不删。话题换了就 `/reset`，比靠裁剪更省 token。

关掉命令执行：

```sh
pnpm tah -- --no-exec --mock chat
```

挂 stdio MCP（子进程，不是官方 SDK）：

```sh
pnpm tah -- --mcp node --mcp-arg ./packages/mcp/test/fixtures/ping-server.mjs --mock "调用 ping"
```

只读策略：

```sh
pnpm tah -- --deny write_file --deny execute_command --mock "只读这个仓库"
```

延迟一轮：

```sh
pnpm tah -- --once 200 --mock run "列出当前目录"
```
