# 路线图

## 总览

| Phase | 主题 | 状态 |
| --- | --- | --- |
| 1 | Runtime 骨架 | ✅ 完成 |
| 2 | Agent：LLM + Tools + Session + Loop + Streaming | ✅ 完成 |
| 3 | Persistence：SQLite + Event Log + Checkpoint + Resume | ✅ 完成 |
| 4 | 生态：MCP + Scheduler + Runnable/Subagent + Permissions | ✅ 完成 |
| 5 | DX：CLI / TUI / Web / Tracing / Plugin 体验 | ✅ CLI + TUI + 本机网页 |
| 6 | 质量地板 + stdio MCP | ✅ |
| 7 | `llm.stream` + `tah` 增量输出 | ✅ |
| 8 | 约定式项目：`AGENTS.md` + `tools/` + `plugins/` + `tah init` | ✅ |
| 9 | TUI（Ink）+ `ChatHost` 会话接口 | ✅ `v0.24` |
| 10 | `tah serve` + 本机网页工作台（HTTP + SSE） | ✅ `v0.25` |
| 11 | 约定式项目热更新（`AGENTS.md` / `tools/` / `plugins/` / `lib/`） | ✅ `v0.26` |
| 12 | 附件（`tah serve`：上传、路径投影、可选 vision） | ✅ `v0.27` |
| 13 | 项目配置（`tah.config.json` 能力包） | ✅ `v0.28` |

## Phase 1 — Runtime ✅

交付物：

- [`packages/core`](https://github.com/MichaelVendor/typescript-agent-harness/tree/main/packages/core)：Runtime / Plugin / Context / ServiceKey / EventBus  
- [`examples/basic-runtime`](https://github.com/MichaelVendor/typescript-agent-harness/tree/main/examples/basic-runtime)：插件协作冒烟  
- 本文档集  

验收：

```sh
pnpm demo:runtime
```

## Phase 2 — Agent ✅

交付物：

- `packages/llm`：OpenAI 兼容 + mock  
- `packages/tools`：registry + executor + `list_files` / `read_file` / `write_file`  
- `packages/agent`：Session、DefaultLoop  
- `examples/basic-agent`：mock（或真实 API）跑通一轮 tool-use  

验收：

```sh
pnpm install && pnpm build && pnpm dev
```

## Phase 3 — Persistence ✅

交付物：

- `packages/storage`：memory + sqlite（Node `node:sqlite`）  
- Session 快照 + 事件日志 + checkpoint  
- `session.resume()` 跨 Runtime 继续  
- `examples/resume-agent`：第一次 tool checkpoint 后模拟崩溃，再 resume  

验收：

```sh
pnpm demo:resume
```

## Phase 4 — 生态 ✅

交付物：

- `packages/permissions`：allow / deny  
- `packages/mcp`：`McpBackend` → 同一套 Tool（in-process ping）  
- `packages/scheduler`：`once` / `every`  
- `subagentTool()`：子 agent 就是 Tool  
- `examples/multi-agent`  

验收：

```sh
pnpm demo:multi
```

## Phase 5 — Developer Experience ✅

交付物：

- `packages/cli`：`tah run` / `tah chat`  
- stdout 事件作为最小 tracing  

验收：

```sh
pnpm tah -- run --mock "列出当前目录"
pnpm tah -- chat
```

TUI 和网页后来在 Phase 9、10 做了；marketplace 不做。

## Phase 6 — Tests, CI, stdio MCP ✅

交付物：

- `pnpm test`（`node:test`）：Runtime、权限、未知工具、resume、stdio MCP
- `.github/workflows/ci.yml`
- `stdioMcpBackend`：同一套 `McpBackend`，子进程 JSON-RPC

验收：

```sh
pnpm build && pnpm test
```

## Phase 7 — Streaming CLI ✅

交付物：

- DefaultLoop 走 `llm.stream()`  
- `agent.assistant-stream`；`tah run` / `tah chat` 边收边打  
- OpenAI 兼容 SSE  

验收：

```sh
pnpm tah -- run --mock "你好"
npx tah --help
```

## Phase 8 — 约定式项目 ✅

不写启动代码，按约定放文件就能基于 `tah` 做自己的 Agent。设计见 [设计说明](https://github.com/MichaelVendor/typescript-agent-harness/blob/main/docs/design/project-convention.md)。

交付物：

- `AGENTS.md` 替换默认人设；`tools/<name>.ts`（`defineTool`）、`plugins/<name>.ts`（`definePlugin`）自动加载，工具名由文件名推导
- 只有 `package.json` 依赖 `@typescript-agent-harness/cli` 的目录才进入项目模式
- 有 `tools/` 时默认不挂内置工具（`--builtin-tools` 恢复）
- `tah init` 骨架；`examples/convention-agent`

验收：

```sh
pnpm demo:convention
mkdir my-agent && cd my-agent && npx @typescript-agent-harness/cli init && npx tah --mock chat
```

## Phase 9 — 终端 UI ✅（v0.24）

设计见 [TUI 与会话接口](/design/tui)。

交付物：

- 终端里 `tah chat` 进 Ink TUI：流式 Markdown、工具调用行、界面内审批、斜杠命令菜单、会话选择器、多行输入
- `ChatHost`（`packages/cli/src/host.ts`）：把 Runtime 事件转成纯 JSON 的 `HostEvent`，TUI 和网页共用
- 管道 / `--plain` 保留逐行模式

验收：

```sh
pnpm tah -- --mock chat
```

## Phase 10 — 本机网页工作台 ✅（v0.25）

设计见 [tah serve 与网页工作台](/design/serve)。

交付物：

- `tah serve`：只监听 `127.0.0.1`，HTTP + SSE 暴露 `ChatHost`；一次性令牌换 HttpOnly cookie，校验 `Host` / `Origin`
- `packages/web`（React + Vite，私有包）：功能与 TUI 对齐，产物随 CLI 发布
- 多个标签页同步同一个会话，断线重连后从服务端补齐

验收：

```sh
pnpm tah -- serve --mock
```

## Phase 11 — 约定式项目热更新 ✅（v0.26）

设计见 [约定式项目热更新](/design/reload)。

交付物：

- 终端 `tah chat` / `tah serve` 监听 `AGENTS.md`、`tools/`、`plugins/`、`lib/`；改动后重建 Runtime 并按 id 重开当前会话
- 一轮进行中改的等这一轮结束；加载失败继续用旧版本并提示原因
- `--no-watch` 关闭；`--no-persist` 只提示重启

验收：

```sh
pnpm demo:convention   # 另开终端改 examples/convention-agent/tools/ 里的文件
```

## Phase 12 — 附件（`tah serve`）✅（v0.27）

设计见 [附件](/design/attachments)。

交付物：

- `tah serve` 可上传文件 / 图片到 `<cwd>/.tah/attachments/`（内容寻址）；会话只存引用
- 默认把只读路径写进 user 文本，模型用工具按需读；`--vision` / `TAH_VISION=1` 时图片进多模态请求
- 网页草稿附件栏与历史卡片；TUI / `tah run` 不做

## Phase 13 — 项目配置（能力包）✅（v0.28）

设计见 [项目配置](/design/config)。

交付物：

- 约定式项目可选根目录 `tah.config.json`：`capabilities`（coding / web / vision）+ `extensions.mcp`
- 合并顺序：内置默认 → config → CLI / 环境变量；无文件时行为与 v0.27 一致
- `capabilities.web: true` 在官方联网工具落地前启动报错；**上网 / 浏览器现阶段用 MCP**（见 [CLI · 上网与浏览器](/guide/cli.md)）；`tah init` 写入示例 config（仅 coding）

## 非目标（刻意不做）

- Phase 1–3 不做 Electron / 完整 Web IDE  
- 不做插件市场  
- 不绑定单一模型厂商 SDK 作为内核依赖  
- 不把 prompt 工程当成 Runtime 的核心抽象  
- v0.28 不做内置浏览器自动化；不做官方 `web_search` / `web_fetch`（键位预留，实现另开）

## 版本策略

- `0.x`：API 可破坏性变更，文档与 CHANGELOG 同步  
- `main`：已发布代码；每个发布打 tag（当前开发分支 `v0.28`）  
- `v0.N`：当前小版本的开发分支，合入 `main` 后打 `v0.N.x`  
- 公共 API 以 `docs/api/*` 与包 `exports` 为准  
