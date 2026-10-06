# Tools 与 Runnable

状态：✅ registry + `list_files` / `read_file` / `write_file` / `grep` / `execute_command`
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
| `execute_command` | 9 | 工作区 cwd 起进程（非 shell；无 sandbox） |
| `grep` | 11 | 工作区正则搜索（跳过 `node_modules` / `dist` / 点文件） |
| MCP ping | 4 | `inProcessPingBackend` |
| MCP stdio | 6 | `stdioMcpBackend` |

## 设计约束

1. Tool 名称在 registry 内唯一  
2. `inputSchema` 必须能投影到 LLM function-calling schema  
3. 执行结果进入 Session 事件日志，而不是只活在内存  
4. 长耗时工具必须尊重 `signal`  
