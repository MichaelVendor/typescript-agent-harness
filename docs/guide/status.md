# 文档状态说明

文档按 **已落地代码** 写。尚未做的能力会标 📐 / 🧭，不再把愿景写成现成 API。

| 标记 | 含义 |
| --- | --- |
| ✅ 已实现 | 代码已落地；冲突时以源码为准 |
| 📐 已设计 | 方向已定，代码未做或只做了一部分 |
| 🧭 规划中 | 以后可能做，现在不要当 API |

当前版本 **v0.28.0**。已实现的包：

| 包 | 作用 |
| --- | --- |
| `@typescript-agent-harness/core` | Runtime / Plugin / Context / Service / EventBus + waterfall 拦截 |
| `@typescript-agent-harness/llm` | mock + OpenAI 兼容（DeepSeek） |
| `@typescript-agent-harness/tools` | registry + list/read/write/grep + execute_command |
| `@typescript-agent-harness/agent` | Session + DefaultLoop + resume + `run_subagent` + 上下文裁剪 |
| `@typescript-agent-harness/storage` | SQLite / memory、事件日志、checkpoint |
| `@typescript-agent-harness/permissions` | allow / deny + 人工审批 |
| `@typescript-agent-harness/mcp` | `McpBackend` → Tool（进程内 ping + stdio） |
| `@typescript-agent-harness/scheduler` | `once` / `every` |
| `@typescript-agent-harness/cli` | `tah run` / `tah chat`（终端 TUI）/ `tah serve`（本机网页工作台）/ `tah init` + 约定式项目（`AGENTS.md`、`tools/`、`plugins/`，改动热更新）+ `tah.config.json` 能力包 |

未做：官方 `capabilities.web`（`web_search` / `web_fetch`）、内置浏览器自动化、官方 MCP SDK 封装、shell/sandbox、插件市场。上网与浏览器现阶段用 `extensions.mcp` / `--mcp`（见 [CLI](/guide/cli.md)）。

各版本「踩了什么坑、为何改、怎么改」见 [版本踩坑与改动](/guide/lessons)。
