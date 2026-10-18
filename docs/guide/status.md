# 文档状态说明

文档按 **已落地代码** 写。尚未做的能力会标 📐 / 🧭，不再把愿景写成现成 API。

| 标记 | 含义 |
| --- | --- |
| ✅ 已实现 | 代码已落地；冲突时以源码为准 |
| 📐 已设计 | 方向已定，代码未做或只做了一部分 |
| 🧭 规划中 | 以后可能做，现在不要当 API |

当前版本 **v1.1.0**。已实现的包：

| 包 | 作用 |
| --- | --- |
| `@typescript-agent-harness/core` | Runtime / Plugin / Context / Service / EventBus + waterfall 拦截 |
| `@typescript-agent-harness/llm` | mock + OpenAI 兼容（DeepSeek）+ 图片消息（不能看图的模型用 `images: false`，v0.33） |
| `@typescript-agent-harness/tools` | registry + list/read/write/edit/grep + execute_command + `todo_write` + `web_fetch` / `web_search`（v0.31；搜索免 key，v0.37.4） |
| `@typescript-agent-harness/agent` | Session + DefaultLoop + resume + `run_subagent` + 上下文压缩与裁剪（v0.31） |
| `@typescript-agent-harness/storage` | SQLite / memory、事件日志、checkpoint |
| `@typescript-agent-harness/permissions` | allow / deny + 人工审批 |
| `@typescript-agent-harness/mcp` | `McpBackend` → Tool（进程内 ping + stdio） |
| `@typescript-agent-harness/scheduler` | `once` / `every` |
| `@typescript-agent-harness/cli` | `tah run` / `tah chat`（终端 TUI）/ `tah serve`（本机网页工作台）/ **`tah agent-host`**（容器无头 `/v1` + Bearer，v1.0，见 [设计说明](/design/agent-host)）/ `tah init` + 约定式项目（`AGENTS.md`、`tools/`、`plugins/`、`skills/`，改动热更新）+ `tah.config.json` 能力包（多个 `extensions.mcp`、`permissions.allow` / `deny`，v0.37.8）· **Skills**（`skill` 工具 + `/name`，v0.29，见 [设计说明](/design/skills)）· 网页工作文件夹与 Settings（v0.30）· 内置浏览器（v0.31）· 输入框模型选择（v0.32）· 每个模型单独设能否看图 + macOS `read_image_text`（v0.33）· 网页文件预览（v0.35，见 [设计说明](/design/file-preview)）· 网页浏览器面板（v0.36，见 [设计说明](/design/browser-pane)）· `ask_user` 让用户选择（v0.37，见 [设计说明](/design/ask-user)）· 忙时排队发消息（v0.37.3，见 [设计说明](/design/queue)） |
| `@typescript-agent-harness/control` | 内网控制面（`v1.1`，私有包、不发 npm）：登录、项目成员、Docker 一项目一 `tah agent-host`、Bearer 代理 `/v1` 与 SSE；见 [设计说明](/design/control-plane) |

另有 macOS 客户端（`apps/desktop`，v0.35，见 [设计说明](/design/desktop)）：窗口里跑 `tah serve`，不发布到 npm；打 `v*.*.*` tag 时 CI 打包 arm64 `.dmg` 并挂到 GitHub Release。

未做：官方 MCP SDK 封装、shell/sandbox、插件市场。上网用官方 `web_fetch` / `web_search`；需要点击、填表、登录时用内置浏览器 `browser_open`（v0.31，见 [内置浏览器](/design/browser)）。

各版本「踩了什么坑、为何改、怎么改」见 [版本踩坑与改动](/guide/lessons)。
