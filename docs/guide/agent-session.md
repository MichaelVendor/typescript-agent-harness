# Agent 与 Session

状态：✅ Phase 2 + 3：`packages/agent` + `packages/storage`；跨 Runtime `resume()` 已可用

## 用法

```ts
const runtime = new Runtime();

runtime.use(storagePlugin({ driver: "sqlite", path: ".tah/data.db" }));
runtime.use(llmPlugin({ provider: "mock" }));
runtime.use(toolsPlugin({ tools: [listFilesTool("."), readFileTool(".")] }));
runtime.use(agentPlugin());

await runtime.start();

const sessions = runtime.get(SESSION);
const session = await sessions.create();
const result = await session.run("分析这个项目的目录结构");
```

## Session

Session 是一次长期对话 / 任务的边界，也是持久化与 resume 的单位。

```ts
interface Session {
  readonly id: string;
  readonly state: SessionState;

  run(input: string | UserMessage): Promise<RunResult>;
  resume(): Promise<RunResult>;
  cancel(): Promise<void>;
}

type SessionState =
  | "idle"
  | "running"
  | "waiting_tool"
  | "completed"
  | "failed"
  | "cancelled";
```

### Session 内部结构（不要只存 messages）

```
Session
├── messages          # 模型可见消息投影（可由事件派生）
├── steps             # AgentStep 序列
├── toolCalls         # 工具调用记录
├── artifacts         # 产出文件 / blob 引用
├── checkpoints       # 可恢复点
└── events            # 追加型事件日志
```

## AgentStep

```ts
type AgentStep =
  | { type: "thinking"; id: string; content?: string }
  | {
      type: "llm";
      id: string;
      request: LLMRequest;
      response?: LLMResponse;
      status: "pending" | "streaming" | "completed" | "failed";
    }
  | {
      type: "tool";
      id: string;
      tool: string;
      input: unknown;
      output?: unknown;
      status: "pending" | "running" | "completed" | "failed";
    };
```

Step 是调试、计费、resume 的基本单位；UI 也应优先渲染 Step，而不是只渲染最终字符串。

## AgentLoop

```ts
interface AgentLoop {
  run(ctx: AgentContext): AsyncIterable<AgentEvent>;
}

interface AgentContext {
  session: Session;
  llm: LLMService;
  tools: ToolService;
  signal: AbortSignal;
}
```

默认循环（概念实现，非最终源码）：

```ts
async function* defaultLoop(ctx: AgentContext): AsyncIterable<AgentEvent> {
  while (true) {
    const response = await ctx.llm.generate({
      messages: ctx.session.messages,
      tools: ctx.tools.listSchemas(),
    });

    yield { type: "llm.completed", response };

    if (!response.toolCalls?.length) {
      yield { type: "agent.finished", response };
      return;
    }

    for (const call of response.toolCalls) {
      yield { type: "tool.started", call };
      const output = await ctx.tools.execute(call);
      yield { type: "tool.finished", call, output };
      ctx.session.appendToolResult(call, output);
    }
  }
}
```

已实现：`DefaultLoop`。其它 Loop（Coding / Research / Parallel / Team）🧭。

`agentPlugin({ systemPrompt?, maxSteps?, contextChars? })` 在 setup 里创建 Loop，不单独暴露 `AGENT_LOOP` ServiceKey。

- `systemPrompt`：新 Session 的首条 system；从存储重开旧 Session 时也会**替换**存下来的那条（当前配置优先，v0.22）
- `maxSteps`：每轮最多几次 LLM 调用（默认 20；`Infinity` 不限）；重开旧 Session 时同样用当前配置，不用存下来的旧值
- `contextChars`：每次 LLM 请求的字符预算（v0.22）；不设则发全量历史

### 上下文裁剪（v0.22）

`projectContext(messages, budgetChars)` 是纯函数：Session 里的完整历史不变，只裁「这次发给模型的那份」，并记进 LLM step 的 `request`。超预算时依次：

1. 省略旧轮次的工具输出（替换成 `[tool output omitted … N chars]`）
2. 从最早开始**整轮**丢弃（user 起到下一条 user 前），并在 system 末尾注明丢了几轮
3. 仍超：省略当前轮里模型已经看过的工具输出；最新一批工具结果与当前轮始终保留

整轮丢弃保证 `tool_calls` 与 tool 结果成对，不会触发 API 的配对校验错误。发生裁剪时发 `agent.context.trimmed`。不做 LLM 摘要。

## Session 服务

```ts
const SESSION = createServiceKey<SessionService>("session");

type SessionService = {
  create(): Promise<Session>;
  get(sessionId: string): Promise<Session | undefined>;
  list(): Promise<SessionSummary[]>;
  fork(sessionId: string, options?: { turns?: number }): Promise<Session>; // v0.22
};
```

`create()` 会 `emit("session.created")`。有 storage 插件时，`get` 会从 SQLite 还原 Session。

`fork()`：复制源 Session 的消息到一个新 Session（新 id、steps / events 从空开始），源 Session 不变；`turns: N` 只保留前 N 轮（按 user 消息分轮，`0` 只剩 system）。发 `session.forked`。用于「回到第 N 轮重来」或「同一上下文试另一条路」。

## Streaming / Cancel

Loop 通过 `AsyncIterable<AgentLoopEvent>` 驱动 Session（含 `llm.delta`）。Session 转发为 `agent.assistant-stream`；CLI 订阅后边收边打字。

`session.cancel()` → `AbortSignal` 传到 LLM / Tool。崩溃后续跑用 `session.resume()`，见 [Storage](./storage.md)。

取消或失败后直接 `run()` 下一轮也可以：开始前会给上一轮没跑完的 tool_calls 补一条「未执行」结果（v0.22），避免 provider 因缺 tool 结果拒绝请求。
