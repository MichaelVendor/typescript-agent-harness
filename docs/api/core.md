# API 参考：`@typescript-agent-harness/core`

状态：✅ 与源码同步（v0.26）  
入口源码：[`packages/core/src/index.ts`](https://github.com/MichaelVendor/typescript-agent-harness/blob/main/packages/core/src/index.ts)

## 安装

工作区内：

```ts
import {
  Runtime,
  createServiceKey,
  type Plugin,
  type Context,
} from "@typescript-agent-harness/core";
```

## `Runtime`

```ts
new Runtime(options?: { id?: string })
```

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | Runtime 标识 |
| `use(plugin)` | `this` | 注册插件；仅 `idle`；重名抛错 |
| `start()` | `Promise<void>` | 顺序 setup；已 `running` 则 noop；某个 setup 抛错时逆序 dispose 已启动的插件、回到 `idle` 后抛出 |
| `stop()` | `Promise<void>` | 逆序 dispose；发完 `runtime.stopped` 后清空 bus |
| `on(type, handler)` | `Unsubscribe` | 订阅事件 |
| `get(key)` | `T` | 仅 `running` 时可取服务 |
| `context()` | `Context` | 当前 Context |
| `getState()` | `RuntimeState` | `idle \| starting \| running \| stopping \| stopped` |

错误示例：

- 启动后 `use` → `Error: Cannot register plugin ...`  
- 重复 `name` → `Error: Duplicate plugin name: ...`  
- 非 running 时 `get` → `Error: Runtime is not running ...`  

## `Plugin`

```ts
interface Plugin {
  readonly name: string;
  setup(ctx: Context): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

type PluginFactory = () => Plugin;
```

## `Context`

```ts
interface Context {
  readonly runtimeId: string;
  get<T>(key: ServiceKey<T>): T;
  tryGet<T>(key: ServiceKey<T>): T | undefined;
  provide<T>(key: ServiceKey<T>, value: T): void;
  emit<TName extends string>(type: TName, payload: EventPayload<TName>): Promise<void>;
  on<TName extends string>(type: TName, handler: EventHandler<EventPayload<TName>>): Unsubscribe;
  intercept<TPayload = unknown, TResult = unknown>(name: string, handler: Interceptor<TPayload, TResult>): Unsubscribe;
  waterfall<TPayload, TResult>(name: string, payload: TPayload, final: (payload: TPayload) => Promise<TResult>): Promise<TResult>;
}
```

`intercept` / `waterfall` 是拦截点（v0.22），用法见 [Runtime · Waterfall](../guide/runtime.md#waterfall-v0-22)。

实现类：`RuntimeContext`（一般无需直接构造）。

## `ServiceKey`

```ts
createServiceKey<T>(id: string): ServiceKey<T>
```

| Error | 何时 |
| --- | --- |
| `ServiceNotFoundError` | `get` 找不到 |
| `ServiceAlreadyProvidedError` | 重复 `provide` 同一 `id` |

## `EventBus`

```ts
class EventBus {
  on<TPayload>(event: string, handler: EventHandler<TPayload>): Unsubscribe;
  emit(event: string, payload?: unknown): Promise<void>;
  clear(): void;
}
```

`emit` 顺序 await 所有 handler。通常通过 `Context` / `Runtime` 使用，不必直接实例化。

## 事件类型

```ts
type EventHandler<TPayload = unknown> = (payload: TPayload) => void | Promise<void>;
type Unsubscribe = () => void;
type Interceptor<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  next: (payload: TPayload) => Promise<TResult>,
) => Promise<TResult>;

interface RuntimeEventMap {
  "runtime.starting": { runtimeId: string };
  "runtime.started": { runtimeId: string };
  "runtime.stopping": { runtimeId: string };
  "runtime.stopped": { runtimeId: string };
  "plugin.setup": { name: string };
  "plugin.dispose": { name: string };
}

type EventPayload<TName extends string> =
  TName extends keyof RuntimeEventMap ? RuntimeEventMap[TName] : unknown;
```

完整约定见 [事件目录](../guide/events.md)。

## 导出清单

```ts
export { Runtime, type RuntimeOptions, type RuntimeState } from "./runtime.js";
export { type Context, RuntimeContext } from "./context.js";
export { type Plugin, type PluginFactory } from "./plugin.js";
export {
  createServiceKey,
  ServiceAlreadyProvidedError,
  ServiceNotFoundError,
  type ServiceKey,
} from "./service.js";
export { EventBus } from "./event-bus.js";
export type {
  EventHandler,
  EventPayload,
  Interceptor,
  KnownEventName,
  RuntimeEvent,
  RuntimeEventMap,
  Unsubscribe,
} from "./events.js";
```
