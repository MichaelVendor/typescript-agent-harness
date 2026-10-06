---
layout: home
hero:
  name: typescript-agent-harness
  text: TypeScript Agent Runtime
  tagline: Everything is a capability. 先设计 Runtime，再长出 Agent。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 设计哲学
      link: /guide/philosophy
    - theme: alt
      text: GitHub
      link: https://github.com/MichaelVendor/typescript-agent-harness
features:
  - title: Runtime 第一公民
    details: 不是 new Agent({ model, tools })，而是用 Plugin 挂载能力，再创建 Session。
  - title: 一切皆 Capability
    details: LLM、Tools、Storage、Scheduler、Permission、Agent 本身都是可替换能力。
  - title: 插件互不耦合
    details: 通过 Context 的 provide / get 与 EventBus 协作，避免 Agent 变成垃圾场。
  - title: 为 Resume 留空间
    details: Session 不只存 messages；Step、Event、Checkpoint 支撑回放与恢复。
---

## 当前进度

| Phase | 主题 | 状态 |
| --- | --- | --- |
| 1 | Runtime 骨架 | ✅ 已完成 |
| 2 | LLM + Tools + Session + Loop | ✅ 已完成 |
| 3 | SQLite / Checkpoint / Resume | ✅ 已完成 |
| 4 | MCP / Scheduler / Permissions | ✅ 已完成 |
| 5 | CLI（无 TUI / Web） | ✅ 已完成 |
| 6 | 测试 / CI / stdio MCP | ✅ 已完成 |
| 7 | stream → tah | ✅ 已完成 |

入口：

```sh
pnpm build
pnpm test
pnpm tah -- run --mock "列出当前目录"
pnpm docs:dev
```
