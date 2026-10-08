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
| `tah chat` | 多轮；**默认续上一次持久化 Session**；stdin 每行一轮，直到 EOF 或 `/exit`；`/reset` 新开 |
| `tah sessions` | 列出已保存的 Session（最新在前；不需要 API key，v0.22） |
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
| `--max-steps <n>` | 每轮 LLM 上限（**默认 32**） |
| `--system-file <path>` | 用文件内容替换默认角色「workspace coding agent」（v0.22） |
| `--session <id\|n>` | `tah chat` 续指定 Session，而不是最近一个（v0.22） |
| `--mcp <cmd>` | 挂上 stdio MCP 工具（默认关） |
| `--mcp-arg <a>` | `--mcp` 的额外参数（可重复） |
| `--allow <tool>` | 白名单（可重复；不写则不限制） |
| `--deny <tool>` | 黑名单（可重复；优先于 `--allow`） |
| `--once <ms>` | 延迟后跑一轮 `tah run`（默认关；仅 `run`） |

不加 `--mock` 时必须有 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`（`<cwd>/.env`，以及仓库内 `examples/basic-agent/.env`）。没有 key 不会再静默 mock。

走到 LLM 步数上限时会打印 `finishReason=max_steps`；可加大 `--max-steps` 或拆任务。

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

## Ctrl+C 与失败重试（v0.22）

| 场景 | 行为 |
| --- | --- |
| `tah chat` 正在跑一轮（含等审批） | 中断这一轮，回到 `you>`；历史保留，可以接着说 |
| `tah chat` 空闲在 `you>` | 退出（同 `/exit`） |
| `tah run` | 直接退出 |
| 模型接口网络错误 / 429 / 5xx | 自动重试 3 次（1s、2s、4s），打印 `[llm] … retry N in Xs` |
| 重试仍失败 | chat 打印 `[tah] turn failed …` 并回到 `you>`，不退出 |

模型在调用工具前说的话（如「我先读一下文件」）会单独成行，和后面的 `[tool]` 日志分开；最终回答若复述了过程，那是模型行为，不是重复打印。

## 输出样式

在终端里，模型回复的 Markdown 会按行渲染：标题加粗、`**粗体**`、行内代码上色、列表变成 `•`、代码块加左侧边框、引用前加竖线；表格画成带边框的对齐表格（中文和 emoji 按两格宽计算，超出终端宽度时在格子内折行）；`[tah]` / `[llm]` / `[tool]` / `[ctx]` 日志变灰；审批卡片用黄色边框。

- 每收到一整行才显示（不再逐字出现）；表格等整张表收完才显示
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
