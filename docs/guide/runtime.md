# Runtime 核心

状态：✅ Phase 1 已实现（`@typescript-agent-harness/core`）

Runtime 是框架的第一公民。骨架只有五件事：

```
Runtime
├── Plugin
├── Context
├── Service（ServiceKey + Registry）
├── EventBus
└── Lifecycle（idle → starting → running → stopping → stopped）
```

## Runtime

```ts
import { Runtime } from "@typescript-agent-harness/core";

const runtime = new Runtime({ id: "my-runtime" });

runtime.use(pluginA);
runtime.use(pluginB);

await runtime.start();
// ...
await runtime.stop();
```

### 生命周期

| 状态 | 含义 |
| --- | --- |
| `idle` | 已创建，可 `use` / `start` |
| `starting` | 正在按注册顺序 `setup` 插件 |
| `running` | 可用 `get` / 业务调用 |
| `stopping` | 正在逆序 `dispose` |
| `stopped` | 已停止；可再次 `start`（会重建 Context） |

规则：

- `use()` **只能**在 `idle` 调用  
- `start()` 按注册顺序调用 `plugin.setup(ctx)`  
- `stop()` 按**逆序**调用 `plugin.dispose?.()`  
- `runtime.stopped` 发出后清空 EventBus，便于观察者听到最终事件  

### 主要 API

| 方法 | 说明 |
| --- | --- |
| `use(plugin)` | 注册插件；重名抛错 |
| `start()` | 启动；幂等（已 running 则直接返回） |
| `stop()` | 停止 |
| `on(type, handler)` | 订阅事件（与 Context 同一条 bus） |
| `get(key)` | running 后解析服务 |
| `context()` | 取得 Context |
| `getState()` | 当前生命周期状态 |

## Plugin

```ts
interface Plugin {
  readonly name: string;
  setup(ctx: Context): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
```

约定：

- `name` 全局唯一  
- `setup` 里 `provide` 服务、`on` 事件  
- `dispose` 释放外部资源（文件句柄、连接等）；事件订阅可由 Runtime 在 stop 时统一清空  

推荐用工厂函数，便于传配置：

```ts
function greeterPlugin(prefix = "Hello"): Plugin {
  return {
    name: "greeter",
    setup(ctx) {
      ctx.provide(GREETER, {
        greet: (name) => `${prefix}, ${name}!`,
      });
    },
  };
}
```

## Context

插件之间的唯一接线面：

```ts
interface Context {
  readonly runtimeId: string;
  get<T>(key: ServiceKey<T>): T;
  tryGet<T>(key: ServiceKey<T>): T | undefined;
  provide<T>(key: ServiceKey<T>, value: T): void;
  emit<TName extends string>(type: TName, payload: EventPayload<TName>): Promise<void>;
  on<TName extends string>(type: TName, handler: EventHandler<EventPayload<TName>>): Unsubscribe;
  intercept<P, R>(name: string, handler: Interceptor<P, R>): Unsubscribe;
  waterfall<P, R>(name: string, payload: P, final: (payload: P) => Promise<R>): Promise<R>;
}
```

| API | 行为 |
| --- | --- |
| `provide` | 注册服务；同一 key 重复注册抛 `ServiceAlreadyProvidedError` |
| `get` | 解析服务；不存在抛 `ServiceNotFoundError` |
| `tryGet` | 可选依赖 |
| `emit` | 顺序 `await` 所有 handler（Phase 1 保证可预测的副作用顺序） |
| `on` | 订阅；返回 `Unsubscribe` |
| `intercept` | 注册 waterfall 拦截器；先注册的在外层（v0.22） |
| `waterfall` | 依次穿过拦截器再执行 `final`；拦截器不调 `next()` 即短路（v0.22） |

## ServiceKey

```ts
const LLM = createServiceKey<LLMService>("llm");

ctx.provide(LLM, impl);
const llm = ctx.get(LLM);
```

- `id` 是运行时查找键（字符串）  
- 泛型 `T` 只存在于类型系统，用于编译期安全  
- 契约类型（interface）可放在共享 types 包或各 capability 包的 `contract.ts`；**实现**仍互不可见  

## EventBus

Phase 1 行为：

- 按事件名维护 `Set<handler>`  
- `emit` **顺序**执行 handler，并 `await` Promise  
- 自定义事件名合法；内置事件见 [事件目录](./events.md)  

### Waterfall（v0.22）

`emit` 只能旁观；要改写输入、拒绝执行、包装结果，用拦截器：

```ts
ctx.intercept<ToolExecution, ToolResult>("tool.execute", async (p, next) => {
  if (p.call.name === "execute_command") console.log("about to run", p.call.arguments);
  return next(p); // 不调 next 就是拦下，直接返回自己的结果
});
```

内置拦截点：`tool.execute`（`packages/tools`，常量 `TOOL_EXECUTE`）。权限与审批都挂在这里。

后续可能增加：并行 emit、按 plugin scope 自动 unsubscribe。

## 最小可运行示例

见 [`examples/basic-runtime`](https://github.com/MichaelVendor/typescript-agent-harness/blob/main/examples/basic-runtime/src/main.ts)：

1. `greeter` / `counter` 提供服务  
2. `trace` 只订阅事件  
3. `app` 消费服务并触发业务事件  

四者互不 import。
