# 事件目录

状态：✅ 下列事件已在代码里发出 · 🧭 未实现的标在文末

Observability、Tracing、Logging、Metrics、Replay、Billing、Audit、CLI 输出 —— 都应挂在事件上，而不是改 Agent 核心逻辑。

```ts
runtime.on("tool.finished", (e) => console.log("tool", e));
runtime.on("llm.request", (e) => console.log("llm", e));
```

自定义事件：任意字符串名 + 任意 payload（类型为 `unknown`）。

## Runtime（`@typescript-agent-harness/core`）

| 事件 | Payload | 何时 |
| --- | --- | --- |
| `runtime.starting` | `{ runtimeId }` | `start()` 开始 |
| `runtime.started` | `{ runtimeId }` | 全部 plugin setup 完成 |
| `runtime.stopping` | `{ runtimeId }` | `stop()` 开始 |
| `runtime.stopped` | `{ runtimeId }` | dispose 完成；随后清空 bus |
| `plugin.setup` | `{ name }` | 单个插件 `setup` 返回后 |
| `plugin.dispose` | `{ name }` | 单个插件 `dispose` 返回后 |

## Session / Agent（`packages/agent`）

| 事件 | Payload |
| --- | --- |
| `session.created` | `{ sessionId }` |
| `session.turn.start` | `{ sessionId, turnId }` |
| `session.turn.end` | `{ sessionId, turnId }` |
| `agent.started` | `{ sessionId }` |
| `agent.finished` | `{ sessionId, text, finishReason }` |
| `agent.failed` | `{ sessionId, error }` |
| `agent.cancelled` | `{ sessionId }` |
| `agent.assistant-stream` | `{ sessionId, text }` |
| `storage.checkpoint` | `{ sessionId, checkpointId, stepId, stepType }` |

`agent.finished` / `cancelled` / `failed` 在 `drive()` 结束时发出。checkpoint 在持久化写盘之后发出。

## LLM（`packages/llm`）

| 事件 | Payload |
| --- | --- |
| `llm.request` | `{ requestId, model, messageCount }` |
| `llm.response` | `{ requestId, model, finishReason, usage }` |
| `llm.error` | `{ requestId, error }` |
| `llm.stream` | `{ requestId, text }` |

## Tools / Permissions（`packages/tools`）

| 事件 | Payload |
| --- | --- |
| `permission.denied` | `{ tool, reason }` |
| `permission.granted` | `{ tool }`（仅配置了权限插件且通过时） |
| `tool.started` | `{ callId, tool, input }` |
| `tool.finished` | `{ callId, tool, output }` |
| `tool.failed` | `{ callId, tool, error }` |

未知工具、权限拒绝、执行抛错都会走 `tool.failed`。

## Scheduler（`packages/scheduler`）

| 事件 | Payload |
| --- | --- |
| `scheduler.job.start` | `{ jobId }` |
| `scheduler.job.end` | `{ jobId, status }`（`ok` 或 `error`） |

## 未实现（🧭）

| 事件 | 说明 |
| --- | --- |
| `agent.step.start` / `agent.step.end` | Loop 内部 step 未单独打 bus |
| `storage.appended` | 事件写入 store 时不发 bus |

## 处理器约定

1. Handler 应快速返回；重活丢到队列 / 后台  
2. 不要在 handler 里假设执行顺序（除 Runtime 生命周期文档写明的顺序 await）  
3. Handler 抛错会中断后续 handler；业务插件应自行 try/catch，除非要 fail-fast  
4. 需要拦截管道时，使用未来的 waterfall API，而不是依赖订阅顺序硬抢  

## 扩展类型（推荐做法）

```ts
type AppEventMap = RuntimeEventMap & AgentEventMap & LLMEventMap & ToolEventMap;
```
