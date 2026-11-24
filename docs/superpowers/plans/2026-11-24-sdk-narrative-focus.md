# SDK 叙事收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把外人看到的 tah 收成「约定式优先的开发者 SDK」：README / 文档站 / init 文案 / npm description 只卖 L1 黄金路径，L2/L3 下沉，不改 Runtime API、不拆包、不砍功能。

**Architecture:** 纯叙事面。三层心智 Build → Embed → Hosts 映射到 README 章节、VitePress nav/sidebar、`tah init` 生成 README、cli 包 description。`tah init` 本身已是「1 人设 + 1 tool + 1 skill」的 hello 样板，不另起 examples 目录以免双份维护；`convention-agent` / `brief-agent` 降为进阶样板链接。

**Tech Stack:** Markdown、VitePress（`docs/.vitepress/config.mts`）、`packages/cli/src/init.ts`、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-24-sdk-narrative-focus-design.md`

## Global Constraints

- 只改叙事 / 文档 / init 文案 / package description；不改 `packages/*/src` 业务逻辑（`init.ts` 的脚手架字符串除外）
- 不拆 npm 包；不删 Super-agent / control / desktop / channels
- 新功能默认进 L3 叙事；只有服务「一小时做出领域 Agent」的进 L1
- 中英文 README 同步；文档站主语言保持 zh-CN
- Conventional Commits；不 push

## File map

| File | Role |
| --- | --- |
| `README.md` / `README.zh-CN.md` | 首屏黄金路径；Embed / Advanced 下沉 |
| `docs/index.md` | 文档站首页：Build 优先，去掉 Phase 表抢戏 |
| `docs/.vitepress/config.mts` | nav + sidebar 按 Build / Embed / Hosts |
| `docs/guide/getting-started.md` | 先 init，后 run/serve；挂验收清单 |
| `docs/guide/hosts.md` | **新建** L3 入口索引（serve / desktop / agent-host / control / channel / super-agent） |
| `packages/cli/src/init.ts` | 脚手架加 `README.md`；`nextSteps` 指向清单 |
| `packages/cli/test/project.test.ts` | 断言新 README / nextSteps |
| `packages/cli/package.json` | description 主推 convention build |
| `package.json`（根） | description 对齐 |
| `examples/convention-agent/README.md` | **新建** 标明「进阶样板，首屏用 init」 |
| `docs/guide/status.md` | 一行指向本设计已落地（任务末） |
| `CHANGELOG.md` | 记叙事收口（任务末） |

---

### Task 1: 根 README 黄金路径首屏

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: Spec §三层心智、§一小时黄金路径
- Produces: 英文/中文首页结构一致（Build → Embed → Advanced）

- [ ] **Step 1: 重写 `README.md` 结构**

保留仓库名、语言切换、Docs 链接。首屏改成：

```markdown
# typescript-agent-harness

English | [中文](./README.zh-CN.md)

**Docs:** https://MichaelVendor.github.io/typescript-agent-harness/ · local: `pnpm docs:dev`

TypeScript **Agent Runtime / SDK** — build your own agent by convention.

> **Everything is a capability.**

## Build an agent (start here)

No startup code: `AGENTS.md` is the role, each file in `tools/` is a tool, each `skills/*/SKILL.md` is a skill.

```sh
mkdir my-agent && cd my-agent
npx @typescript-agent-harness/cli init
npx tah --mock chat
```

Then: edit `AGENTS.md` → add `tools/*.ts` (`defineTool`) → optional `skills/*/SKILL.md` → keep chatting (`/` invokes skills).

**One-hour checklist:** init works · tool hot-reloads on save · `/hello` (or your skill) works · mock round proves “this is my agent”.

Full guide: [Getting started](./docs/guide/getting-started.md) · [CLI · convention projects](./docs/guide/cli.md)

## Embed the Runtime

Plugins talk only through Context (advanced):

```ts
const runtime = new Runtime();
runtime.use(llmPlugin({ provider: "mock" }));
runtime.use(toolsPlugin({ tools: [listFilesTool(process.cwd())] }));
runtime.use(agentPlugin());
await runtime.start();
const session = await runtime.get(SESSION).create();
await session.run("列出当前目录并总结");
```

See [Philosophy](./docs/guide/philosophy.md) · [Architecture](./docs/guide/architecture.md) · [API](./docs/api/core.md)

## Advanced hosts (optional)

Local TUI/web, desktop, headless host, intranet control plane, Super-agent / IM — not required to build an agent:

- `tah chat` / `tah serve` — [CLI](./docs/guide/cli.md)
- Index: [Hosts](./docs/guide/hosts.md) (added in Task 2)

## Install / from source

(keep existing npx/global install + `pnpm install && pnpm build` blocks; move “v0.26 current” / long phase table out of the hero — replace with a short “Layout” + link to [roadmap](./docs/guide/roadmap.md))
```

删掉或下移：首屏里的 `tah serve` 演示优先、过时 “v0.26 (current)” 大段、冗长 Phase 表（改链 roadmap）。

- [ ] **Step 2: 同步 `README.zh-CN.md`**

同一结构，中文表述；链接指向同一 docs 路径。

- [ ] **Step 3: 目视验收**

打开两个 README：前 30 行必须出现 `init`，且 `serve` / Super-agent 不在首屏主 CTA。

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "$(cat <<'EOF'
docs: README 首屏改为约定式造 Agent

EOF
)"
```

---

### Task 2: 文档站 Build / Embed / Hosts

**Files:**
- Modify: `docs/index.md`
- Modify: `docs/.vitepress/config.mts`
- Modify: `docs/guide/getting-started.md`
- Create: `docs/guide/hosts.md`

**Interfaces:**
- Consumes: Task 1 的三层命名（Build / Embed / Hosts）
- Produces: `/guide/hosts` 页面；sidebar 可见三组；getting-started 以 init 为第一节主路径

- [ ] **Step 1: 重写 `docs/index.md` hero**

```yaml
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
```

首页正文：删掉冗长 Phase 表，改成三链（Build → getting-started，Embed → philosophy/runtime，Hosts → `/guide/hosts`）+ `pnpm docs:dev`。完整 Phase 仍在 `/guide/roadmap`。

- [ ] **Step 2: 新建 `docs/guide/hosts.md`**

```markdown
# Hosts（可选宿主）

造自己的 Agent **不需要**这些。需要本机 UI、无头 API、内网多项目或 IM 时再看。

| 宿主 | 入口 | 文档 |
| --- | --- | --- |
| 终端 TUI | `tah chat` | [CLI](/guide/cli)、[TUI](/design/tui) |
| 本机网页 | `tah serve` | [serve](/design/serve) |
| macOS 客户端 | `apps/desktop` | [desktop](/design/desktop) |
| 无头 API | `tah agent-host` | [agent-host](/design/agent-host) |
| 内网控制面 | `apps/control` | [control-plane](/design/control-plane)、[教程](/guide/tutorial-intranet) |
| Super-agent / IM | `--super-agent` / `tah channel-host` | [status](/guide/status) 内 Super-agent / channels 条目 |

回到 [快速开始](/guide/getting-started)。
```

- [ ] **Step 3: 改 `docs/.vitepress/config.mts`**

1. `description` 改为含 “约定式项目 / Build agents by convention”。
2. `nav` 改为：

```ts
nav: [
  { text: "Build", link: "/guide/getting-started", activeMatch: "/guide/" },
  { text: "Embed", link: "/guide/runtime", activeMatch: "/api/" },
  { text: "Hosts", link: "/guide/hosts" },
  { text: "配置", link: "/design/config", activeMatch: "/design/" },
  { text: "路线图", link: "/guide/roadmap" },
],
```

（Embed 仍用 guide runtime + api sidebar；Hosts 单页即可。）

3. `sidebarGuide()` 重组为三组（保留原有链接，只改分组文案与顺序）：

```ts
function sidebarGuide() {
  return [
    {
      text: "Build",
      items: [
        { text: "快速开始", link: "/guide/getting-started" },
        { text: "教程：文档问答 Agent", link: "/guide/tutorial-docs-agent" },
        { text: "CLI", link: "/guide/cli" },
        { text: "配置 tah.config.json", link: "/design/config" },
      ],
    },
    {
      text: "Embed",
      items: [
        { text: "设计哲学", link: "/guide/philosophy" },
        { text: "整体架构", link: "/guide/architecture" },
        { text: "Runtime", link: "/guide/runtime" },
        { text: "Agent 与 Session", link: "/guide/agent-session" },
        { text: "LLM", link: "/guide/llm" },
        { text: "Tools 与 Runnable", link: "/guide/tools" },
        { text: "Storage 与 Checkpoint", link: "/guide/storage" },
        { text: "事件目录", link: "/guide/events" },
        { text: "生态", link: "/guide/ecosystem" },
        { text: "编写插件", link: "/guide/plugins" },
        { text: "API：core", link: "/api/core" },
      ],
    },
    {
      text: "Hosts",
      items: [
        { text: "Hosts 索引", link: "/guide/hosts" },
        { text: "教程：内网控制面", link: "/guide/tutorial-intranet" },
      ],
    },
    {
      text: "其它",
      items: [
        { text: "文档状态说明", link: "/guide/status" },
        { text: "版本踩坑与改动", link: "/guide/lessons" },
        { text: "路线图", link: "/guide/roadmap" },
      ],
    },
  ];
}
```

`sidebarDesign()` 顶部加链到 `/guide/hosts`；设计说明列表顺序：约定式 / reload / skills 靠前，serve / desktop / control 靠后（已大致如此则微调即可）。

- [ ] **Step 4: 改 `docs/guide/getting-started.md`**

1. 把 **「做自己的 Agent」** 整节移到 **「用 CLI 跑一轮」之前**，作为第一节主路径。
2. 在该节末尾加 **一小时验收清单**（与 Spec 一致）：

```markdown
### 一小时验收清单

- [ ] `npx @typescript-agent-harness/cli init` 成功，目录含 `AGENTS.md`、`tools/`、`skills/hello/`
- [ ] `npx tah --mock chat` 能聊；改 `tools/` 保存后热更新（或见提示）
- [ ] 输入 `/hello`（或技能菜单）能走到 hello skill
- [ ] 能让 agent 调用你的 tool，并回答「这是我的 agent」

进阶样板：`examples/convention-agent`（`pnpm demo:convention`）、`examples/brief-agent`（垂直业务）。可选宿主见 [Hosts](/guide/hosts)。
```

3. 「用 CLI 跑一轮」保留，但标明「未建项目时的试跑」；`tah serve` 改成指向 Hosts，不在主路径展开。
4. 「公司内网…」链到 hosts / tutorial-intranet，不放首段。

- [ ] **Step 5: 本地预览**

```sh
pnpm docs:dev
```

Expected: 首页 tagline 含 init；顶栏有 Build / Embed / Hosts；`/guide/hosts` 可开；getting-started 第一节是造 Agent。

- [ ] **Step 6: Commit**

```bash
git add docs/index.md docs/.vitepress/config.mts docs/guide/getting-started.md docs/guide/hosts.md
git commit -m "$(cat <<'EOF'
docs: 文档站按 Build / Embed / Hosts 收口

EOF
)"
```

---

### Task 3: `tah init` 脚手架 README + nextSteps

**Files:**
- Modify: `packages/cli/src/init.ts`
- Modify: `packages/cli/test/project.test.ts`

**Interfaces:**
- Consumes: Spec 黄金路径 + 验收清单文案
- Produces: 新项目根目录 `README.md`；`nextSteps()` 含 checklist 提示行

- [ ] **Step 1: 先改测试（失败）**

在 `packages/cli/test/project.test.ts` 的 `tah init scaffolds…` 测试中追加：

```ts
assert.match(out, /create {2}README\.md/);
assert.match(
  readFileSync(path.join(cwd, "README.md"), "utf8"),
  /npx tah --mock chat/,
);
assert.match(nextSteps().join("\n"), /One-hour checklist|一小时/);
```

（`nextSteps` 断言可用中英任一关键词；实现时选中文或双语一行均可，测试与实现对齐。）

- [ ] **Step 2: 跑测试确认失败**

```sh
pnpm --filter @typescript-agent-harness/cli build && \
  node --test --experimental-strip-types packages/cli/test/project.test.ts
```

Expected: FAIL — 无 `README.md` create / nextSteps 不匹配。

- [ ] **Step 3: 实现脚手架**

在 `packages/cli/src/init.ts` 增加：

```ts
const PROJECT_README = `# My tah agent

Convention project for [typescript-agent-harness](https://github.com/MichaelVendor/typescript-agent-harness).

## Golden path

1. Edit \`AGENTS.md\` (role).
2. Add or edit \`tools/*.ts\` (\`defineTool\`).
3. Optional: add \`skills/<name>/SKILL.md\`.
4. Run:

\`\`\`sh
npx tah --mock chat
# or: copy .env.example → .env and \`npx tah chat\`
\`\`\`

## One-hour checklist

- [ ] init files present (\`AGENTS.md\`, \`tools/\`, \`skills/hello/\`)
- [ ] mock chat works; saving a tool reloads (or follow CLI hint)
- [ ] \`/hello\` skill works
- [ ] your tool is called in a round

Docs: https://MichaelVendor.github.io/typescript-agent-harness/guide/getting-started
`;
```

把 `["README.md", PROJECT_README]` 加入 `files` 数组（建议紧接 `package.json` 之后）。

更新 `nextSteps`：

```ts
export function nextSteps(install?: string): string[] {
  return [
    "",
    "Next:",
    ...(install ? [`  ${install}`] : []),
    "  cp .env.example .env    # fill in DEEPSEEK_API_KEY, or skip and use --mock",
    "  npx tah --mock chat     # or: npx tah chat",
    "  One-hour checklist: edit AGENTS.md → tools/ → /hello → prove it is your agent (see README.md)",
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

同 Step 2 命令。Expected: PASS（含既有 skip/overwrite 行为）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init.ts packages/cli/test/project.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): init 写入 README 与一小时清单提示

EOF
)"
```

---

### Task 4: npm description + 进阶样板说明 + 收尾文档

**Files:**
- Modify: `packages/cli/package.json`（`description`）
- Modify: `package.json`（根 `description`）
- Create: `examples/convention-agent/README.md`
- Modify: `docs/guide/status.md`（文首或 CLI 行旁加一句叙事收口已落地 + 链到 spec）
- Modify: `CHANGELOG.md`（Unreleased 或下一版小节加 docs 条目）

**Interfaces:**
- Consumes: Task 1–3 已合并的叙事
- Produces: npm 文案与仓库样板标签一致

- [ ] **Step 1: 改 description**

`packages/cli/package.json`:

```json
"description": "tah — build agents by convention (AGENTS.md, tools/, skills/); TypeScript agent runtime CLI"
```

根 `package.json`:

```json
"description": "TypeScript Agent Runtime / SDK — build agents by convention; everything is a capability"
```

- [ ] **Step 2: 写 `examples/convention-agent/README.md`**

```markdown
# convention-agent

进阶约定式样板（tools + plugins + lib）。**新人请先** \`npx @typescript-agent-harness/cli init\`，不要从本目录抄起。

\`\`\`sh
# 仓库根目录
pnpm demo:convention
\`\`\`

垂直业务样板见 \`examples/brief-agent\`。叙事分层见 \`docs/superpowers/specs/2026-11-24-sdk-narrative-focus-design.md\`。
```

- [ ] **Step 3: status + CHANGELOG**

- `docs/guide/status.md`：在合适位置加一句「对外叙事：Build / Embed / Hosts（spec `2026-11-24-sdk-narrative-focus`）」。
- `CHANGELOG.md`：`### Docs` 下记 README / 文档站 / init README 收口。

- [ ] **Step 4: 整体目视验收（对照 Spec）**

| Spec 项 | 怎么验 |
| --- | --- |
| README 30 秒知 init | 打开根 README 前屏 |
| 文档三层导航 | `pnpm docs:dev` 顶栏 Build/Embed/Hosts |
| 黄金路径清单 | getting-started + init README |
| L3 仍可达 | `/guide/hosts` 各链 |
| 不拆包不砍功能 | `git diff` 无 apps/super-agent 删除 |

- [ ] **Step 5: Commit**

```bash
git add packages/cli/package.json package.json examples/convention-agent/README.md docs/guide/status.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: npm 描述与样板对齐 SDK 叙事

EOF
)"
```

---

## Order

Task 1 → Task 2 → Task 3 → Task 4

## Spec coverage (self-review)

| Spec 要求 | Task |
| --- | --- |
| L1/L2/L3 三层心智 | 1, 2 |
| README 只卖 L1 | 1 |
| 文档站 Build·Embed·Hosts | 2 |
| 一小时黄金路径 + 清单 | 2, 3 |
| 最小 hello 样板 | 3（init = hello；不另建 examples/hello-agent） |
| npm description | 4 |
| init 生成物指向路径 | 3 |
| 不改 API / 不砍 L3 | 全局约束；Hosts 索引保留入口 |
| brief-agent 降权 | 2 getting-started 进阶链接；4 convention README |

**故意不做：** 新建 `examples/hello-agent`（与 init 双份维护）；拆包；冻结产品功能。
