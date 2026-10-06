# 编写插件

状态：✅ 基础模式可用 · 📐 高级模式随 Phase 演进

## 最小插件

```ts
import { type Plugin, createServiceKey } from "@typescript-agent-harness/core";

export interface Clock {
  now(): Date;
}

export const CLOCK = createServiceKey<Clock>("clock");

export function clockPlugin(): Plugin {
  return {
    name: "clock",
    setup(ctx) {
      ctx.provide(CLOCK, { now: () => new Date() });
    },
  };
}
```

## 三种插件角色

| 角色 | 做什么 | 例子 |
| --- | --- | --- |
| Provider | `provide` 服务 | LLM、Tools、Storage |
| Consumer | `get` 服务并编排 | Agent Loop、Application |
| Observer | 只 `on` 事件 | Trace、Metrics、Billing |

同一个插件可以同时是 Provider + Observer，但应避免在 Observer 里偷偷改业务状态。

## 推荐文件布局

```
packages/llm/
  src/
    contract.ts    # LLMService + LLM ServiceKey + 公共类型
    plugin.ts      # llmPlugin()
    openai.ts      # 具体 provider（可对内）
    events.ts      # 本域事件名常量
    index.ts
```

对外只导出：`contract` 类型、`ServiceKey`、`plugin` 工厂、事件名常量。  
不要导出「请直接 new 的内部类」给其他 capability 包。

## 依赖其它服务

```ts
setup(ctx) {
  const llm = ctx.get(LLM); // 要求 LLM 插件先注册
  ctx.provide(SESSION, createSessionService({ llm, tools: ctx.get(TOOLS) }));
}
```

**注册顺序 = setup 顺序**。文档与示例应写明依赖顺序；未来可加声明式 `dependencies: ["llm"]`（🧭）。

可选依赖：

```ts
const storage = ctx.tryGet(STORAGE);
```

## 发出事件

```ts
await ctx.emit("llm.request", { requestId, model });
```

自定义事件 payload 在 Phase 1 类型为 `unknown`；调用方自行约定形状，并在本包 `events.ts` 写清。

## 不要做的事

1. `import { OpenAIProvider } from "@typescript-agent-harness/llm/internal"` 之类跨包掏实现  
2. 在 `Agent` 构造函数里 new 一堆依赖  
3. 用全局单例绕过 Context  
4. 在事件 handler 里执行长时间阻塞而不尊重取消  
5. 改写历史 Session 事件（应追加）  

## 测试插件

```ts
const runtime = new Runtime({ id: "test" });
runtime.use(clockPlugin());
runtime.use({
  name: "assert",
  setup(ctx) {
    const clock = ctx.get(CLOCK);
    assert.ok(clock.now() instanceof Date);
  },
});
await runtime.start();
await runtime.stop();
```

## Application 也是插件

Coding / Research Agent 不应特殊化成 Runtime 内核。它们是挂在 Runtime 上的 Application 插件或独立 examples：

```ts
runtime
  .use(llmPlugin(...))
  .use(toolsPlugin(...))
  .use(agentPlugin(...))
  .use(codingAppPlugin(...)); // 注册 prompt、工具集、斜杠命令等
```
