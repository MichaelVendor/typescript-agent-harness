# 路线图

## 总览

| Phase | 主题 | 状态 |
| --- | --- | --- |
| 1 | Runtime 骨架 | ✅ 完成 |
| 2 | Agent：LLM + Tools + Session + Loop + Streaming | ✅ 完成 |
| 3 | Persistence：SQLite + Event Log + Checkpoint + Resume | ✅ 完成 |
| 4 | 生态：MCP + Scheduler + Runnable/Subagent + Permissions | ✅ 完成 |
| 5 | DX：CLI / TUI / Web / Tracing / Plugin 体验 | ✅ CLI 完成（无 Web/TUI） |
| 6 | 质量地板 + stdio MCP | ✅ |
| 7 | `llm.stream` + `tah` 增量输出 | ✅ 当前 |

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

未做：TUI、Web、插件脚手架、marketplace。

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

## 非目标（刻意不做）

- Phase 1–3 不做 Electron / 完整 Web IDE  
- 不做插件市场  
- 不绑定单一模型厂商 SDK 作为内核依赖  
- 不把 prompt 工程当成 Runtime 的核心抽象  

## 版本策略

- `0.x`：API 可破坏性变更，文档与 CHANGELOG 同步  
- `main`：已发布代码；每个发布打 tag（当前开发 `v0.22`）  
- `v0.N`：下一个小版本的开发分支，合入 `main` 后打 `v0.N.0`  
- 公共 API 以 `docs/api/*` 与包 `exports` 为准  
