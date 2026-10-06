# 设计哲学

状态：🧭 贯穿全框架 · ✅ Phase 1 已按此落地

## 一句话

> **Everything is a capability.**  
> Runtime 负责发现、注入、编排、持久化、观察这些 capability —— 而不是把一切塞进 `Agent`。

## 不要从 Agent 框架开始

常见写法：

```ts
const agent = new Agent({
  model,
  tools,
  memory,
});
```

问题：`Agent` 会变成垃圾场 —— LLM、MCP、DB、Scheduler、Permission、Filesystem… 最终全部堆进构造函数。

typescript-agent-harness 反过来：

```ts
const runtime = new Runtime();

runtime.use(llmPlugin());
runtime.use(toolPlugin());
runtime.use(sessionPlugin());
runtime.use(storagePlugin());

await runtime.start();

const session = await runtime.get(SESSION).create();
await session.run("分析这个项目");
```

第一公民是 **Runtime**，不是 Agent。

## Capability ≠ Tool

| 说法 | 含义 |
| --- | --- |
| Everything is a tool | 模型能调用的函数列表 |
| Everything is a capability | Runtime 可挂载的能力：LLM、Tool、Storage、Scheduler、Permission、Agent 本身 |

Tool 只是 capability 的一种。Subagent、Workflow、MCP 后端、持久化，都是 capability。

## 插件之间禁止直接耦合

反模式：

```ts
class Agent {
  constructor(
    private llm: LLM,
    private database: Database,
    private mcp: MCPClient,
  ) {}
}
```

正确模式：

```ts
// 提供方
ctx.provide(LLM, impl);

// 消费方
const llm = ctx.get(LLM);

// 观察方（不依赖服务实现）
ctx.on("llm.response", (e) => { /* trace / billing */ });
```

插件只依赖 **ServiceKey 契约** 和 **事件名**，不互相 import 实现。

## Session 不是 messages[]

Chatbot 框架常把一切塞进 `messages[]`。Harness 把 Session 拆成可持久化、可回放的结构：

```
Session
├── Message
├── AgentStep
├── ToolCall
├── Artifact
├── Checkpoint
└── Event
```

这是日后 `resume` / `replay` / debugging 的基础。

## Loop 可替换

默认 ReAct 循环只是一种 `AgentLoop` 实现。CodingLoop、ResearchLoop、TeamLoop 都应该能挂上，而不改 Runtime 内核。

## Agent / Tool / Subagent 同一抽象

```ts
interface Runnable<I, O> {
  run(input: I, ctx: Context): Promise<O>;
}
```

从 Runtime 看，它们都是 Runnable。不必单独发明 `SubAgentManager`。

## 先 Runtime，后 UI

很多项目死在「先做漂亮 UI，Runtime 却没设计好」。本项目严格分 Phase：

1. Runtime 骨架  
2. Agent 能力  
3. Persistence  
4. 生态（MCP / Scheduler / Permissions）  
5. 开发者体验（CLI ✅；TUI / Web 未做）

CLI 是 Application 层。Runtime 不内嵌 UI。
