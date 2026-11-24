---
layout: home
hero:
  name: typescript-agent-harness
  text: 用约定造自己的 Agent
  tagline: Runtime / SDK — Everything is a capability. 默认入口：tah init。
  actions:
    - theme: brand
      text: 快速开始（init）
      link: /guide/getting-started
    - theme: alt
      text: 设计哲学
      link: /guide/philosophy
    - theme: alt
      text: GitHub
      link: https://github.com/MichaelVendor/typescript-agent-harness
features:
  - title: Build — 约定式项目
    details: AGENTS.md + tools/ + skills/，不用写启动代码；热更新保持对话。
  - title: Embed — Runtime API
    details: Plugin + Context + EventBus；嵌进自家服务时再打开。
  - title: Hosts — 可选宿主
    details: tah chat / serve、desktop、agent-host、控制面、Super-agent — 造 Agent 不必须。
  - title: 一切皆 Capability
    details: LLM、Tools、Storage、Scheduler、Permission、Agent 本身都是可替换能力。
---

## 从哪开始

- **[Build](/guide/getting-started)** — `tah init`，约定式造自己的 Agent。
- **[Embed](/guide/philosophy)** — 设计哲学与 [Runtime](/guide/runtime) API，嵌进自家服务时用。
- **[Hosts](/guide/hosts)** — 终端 TUI、本机网页、desktop、无头 API 等可选宿主。

完整 Phase 进度见 [路线图](/guide/roadmap)。

本地预览文档站：

```sh
pnpm docs:dev
```