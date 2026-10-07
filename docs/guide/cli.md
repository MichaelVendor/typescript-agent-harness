# CLI

状态：✅ Phase 5（`packages/cli`）· v0.21 默认偏向本机 coding

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
| `tah help` | 用法 |

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
| `--max-steps <n>` | 每轮 LLM 上限（**默认 32**） |
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
