# Tools 与 Runnable

状态：✅ registry + `list_files` / `read_file` / `write_file` / `edit_file` / `grep` / `execute_command` / `todo_write` / `web_fetch` / `web_search` / `browser_open`（内置浏览器）
MCP / Subagent / 权限见 [生态](./ecosystem.md)（Phase 4）

## Tool 接口

```ts
interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

interface ToolContext {
  sessionId: string;
  callId: string;
  signal: AbortSignal;
  /** 受限 Context：可 get 白名单服务，不可随意 provide */
  runtime: Pick<Context, "get" | "tryGet" | "emit">;
}
```

## ToolService

```ts
const TOOLS = createServiceKey<ToolService>("tools");

interface ToolService {
  register(tool: Tool): void;
  list(): Tool[];
  listSchemas(): ToolSchema[];
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
}
```

挂载方式：

```ts
runtime.use(
  toolsPlugin({
    tools: [listFilesTool("."), readFileTool("."), grepTool("."), writeFileTool("."), executeCommandTool(".")],
  }),
);
```

`execute` 需要 `ToolContext`（`sessionId` / `callId` / `signal` / `runtime`）。

## 执行管道

当前实现（`packages/tools`）：

```
permission.visible / permission.check  →  execute  →  tool.finished | tool.failed
```

| 事件 | 何时 |
| --- | --- |
| `permission.denied` / `permission.granted` | 配置了权限插件时 |
| `tool.started` | 即将执行 |
| `tool.finished` | 成功结束 |
| `tool.failed` | 未知工具、被拒、或抛错 |

**只读 Agent = 不注册写工具**，这是硬边界；prompt 只是软提示。权限插件见 [生态](./ecosystem.md)。

## MCP

进程内 ping 与 `stdioMcpBackend` 都适配成同一个 `Tool`。没有把官方 MCP SDK 绑进内核。

```ts
runtime.use(mcpPlugin({ backend: inProcessPingBackend() }));
```

对 Loop 而言没有「MCP 特殊路径」——只有 `ToolService.execute`。

## Runnable：统一 Agent / Tool / Subagent

```ts
interface Runnable<I, O> {
  readonly name: string;
  run(input: I, ctx: Context): Promise<O>;
}
```

| 实现 | 输入 | 输出 |
| --- | --- | --- |
| Tool | 结构化 args | 结构化 result |
| Agent / Session | 自然语言 / 任务 | RunResult |
| Workflow | 工作流参数 | 汇总结果 |

主 Agent 调用子 Agent：

```
Main Agent
 ├── Research Agent  (Runnable)
 ├── Coding Agent     (Runnable)
 └── Review Agent    (Runnable)
```

不必单独维护 `SubAgentManager`；注册表可以是 `RunnableRegistry`，Tool 只是其中一类。

## 内置工具候选（Coding Agent）

| Tool | Phase | 说明 |
| --- | --- | --- |
| `list_files` | 2 | 列目录 |
| `read_file` | 2 | 读文件 |
| `write_file` | 2 | 写文件（可配 permission deny） |
| `edit_file` | 0.31 | 按原文替换片段：`old_string` 必须恰好出现一次，否则报出现次数；`replace_all: true` 全部替换；需要审批 |
| `todo_write` | 0.31 | 任务清单：每次传整份 `todos`（`content` + `pending` / `in_progress` / `completed`，最多 50 项），全量替换；不需要审批。提示词要求 3 步以上的任务使用 |
| `web_fetch` | 0.31 | 读公网网页（拒绝内网 / 回环地址，重定向逐跳检查），HTML 转纯文本，默认 3 万字符、`max_chars` 最多 10 万；不需要审批。见 [tah.config.json](/design/config) |
| `web_search` | 0.31 | Tavily 搜索，返回标题 / 链接 / 摘要（`max_results` 1–10，默认 5）；有 Tavily key 才挂 |
| `browser_open` | 0.31 | 启动内置浏览器（Playwright MCP + 本机 Chrome），可带 `url`；浏览器没开时需要审批，已开时直接放行。打开后挂上 18 个 `browser_*` 工具（`browser_navigate` / `browser_snapshot` / `browser_find` / `browser_click` / `browser_type` / `browser_fill_form` / `browser_take_screenshot` / `browser_close` 等），结果超过 3 万字符截断，截图不回传给模型；`browser_file_upload` 每次审批，`browser_close` 后撤下这些工具。见 [内置浏览器](/design/browser) |
| `ask_user` | 0.37 | 向用户提 1–4 个选择题（每题 2–5 个选项，可多选，用户也能自己输入），等回答后把答案交回模型；只在 `tah serve` / `tah chat` 挂，`--yes` 不影响。见 [让用户选择](/design/ask-user) |
| `execute_command` | 9 | 工作区 cwd 起进程（非 shell；无 sandbox）；默认 30 秒超时，模型可按次传 `timeoutMs`（最长 10 分钟） |
| `grep` | 11 | 工作区正则搜索（跳过 `node_modules` / `dist` / 点文件） |
| MCP ping | 4 | `inProcessPingBackend` |
| MCP stdio | 6 | `stdioMcpBackend` |

## 设计约束

1. Tool 名称在 registry 内唯一  
2. `inputSchema` 必须能投影到 LLM function-calling schema  
3. 执行结果进入 Session 事件日志，而不是只活在内存  
4. 长耗时工具必须尊重 `signal`  
