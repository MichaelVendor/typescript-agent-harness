# 路线图

## 总览

| Phase | 主题 | 状态 |
| --- | --- | --- |
| 1 | Runtime 骨架 | ✅ 完成 |
| 2 | Agent：LLM + Tools + Session + Loop + Streaming | ✅ 完成 |
| 3 | Persistence：SQLite + Event Log + Checkpoint + Resume | ✅ 完成 |
| 4 | 生态：MCP + Scheduler + Runnable/Subagent + Permissions | ✅ 完成 |
| 5 | DX：CLI / TUI / Web / Tracing / Plugin 体验 | ✅ CLI + TUI + 本机网页 |
| 6 | 质量地板 + stdio MCP | ✅ |
| 7 | `llm.stream` + `tah` 增量输出 | ✅ |
| 8 | 约定式项目：`AGENTS.md` + `tools/` + `plugins/` + `tah init` | ✅ |
| 9 | TUI（Ink）+ `ChatHost` 会话接口 | ✅ `v0.24` |
| 10 | `tah serve` + 本机网页工作台（HTTP + SSE） | ✅ `v0.25` |
| 11 | 约定式项目热更新（`AGENTS.md` / `tools/` / `plugins/` / `lib/`） | ✅ `v0.26` |
| 12 | 附件（`tah serve`：上传、路径投影、可选 vision） | ✅ `v0.27` |
| 13 | 项目配置（`tah.config.json` 能力包） | ✅ `v0.28` |
| 14 | Skills（`SKILL.md`、catalog、`skill` 工具、`/name`、热更新） | ✅ `v0.29` |
| 15 | 网页工作文件夹 + Settings（模型、API key） | ✅ `v0.30` |
| 16 | 内置工具补齐（`edit_file`、`todo_write`、`web_fetch` / `web_search`、内置浏览器）+ 上下文压缩 | ✅ `v0.31` |
| 17 | 网页参考 DeepSeek Harness：侧栏、输入框模型选择 | ✅ `v0.32` |
| 18 | 看图：每个模型单独设能否看图，macOS `read_image_text` 识别图中文字 | ✅ `v0.33` |
| 19 | macOS 客户端（`apps/desktop`，壳里跑 `tah serve`） | ✅ `v0.35` |
| 20 | 文件预览：对话里的路径在右侧面板只读预览 | ✅ `v0.35` |
| 21 | 浏览器面板：Agent 的浏览器画面放进工作台，用户可看可接手 | ✅ `v0.36` |
| 22 | AgentHost：无头 `tah agent-host`（Bearer、`/v1`、按轮 SSE） | ✅ `v1.0` |
| 23 | 内网控制面：`apps/control`（登录、项目、Docker wake、代理 AgentHost） | ✅ `v1.1` |

## Phase 1 — Runtime ✅

交付物：

- [`packages/core`](https://github.com/MichaelVendor/typescript-agent-harness/tree/main/packages/core)：Runtime / Plugin / Context / ServiceKey / EventBus  
- [`examples/basic-runtime`](https://github.com/MichaelVendor/typescript-agent-harness/tree/main/examples/basic-runtime)：插件协作冒烟  
- 本文档集  

验收：

```sh
pnpm demo:runtime
```

## Phase 2 — Agent ✅

交付物：

- `packages/llm`：OpenAI 兼容 + mock  
- `packages/tools`：registry + executor + `list_files` / `read_file` / `write_file`  
- `packages/agent`：Session、DefaultLoop  
- `examples/basic-agent`：mock（或真实 API）跑通一轮 tool-use  

验收：

```sh
pnpm install && pnpm build && pnpm dev
```

## Phase 3 — Persistence ✅

交付物：

- `packages/storage`：memory + sqlite（Node `node:sqlite`）  
- Session 快照 + 事件日志 + checkpoint  
- `session.resume()` 跨 Runtime 继续  
- `examples/resume-agent`：第一次 tool checkpoint 后模拟崩溃，再 resume  

验收：

```sh
pnpm demo:resume
```

## Phase 4 — 生态 ✅

交付物：

- `packages/permissions`：allow / deny  
- `packages/mcp`：`McpBackend` → 同一套 Tool（in-process ping）  
- `packages/scheduler`：`once` / `every`  
- `subagentTool()`：子 agent 就是 Tool  
- `examples/multi-agent`  

验收：

```sh
pnpm demo:multi
```

## Phase 5 — Developer Experience ✅

交付物：

- `packages/cli`：`tah run` / `tah chat`  
- stdout 事件作为最小 tracing  

验收：

```sh
pnpm tah -- run --mock "列出当前目录"
pnpm tah -- chat
```

TUI 和网页后来在 Phase 9、10 做了；marketplace 不做。

## Phase 6 — Tests, CI, stdio MCP ✅

交付物：

- `pnpm test`（`node:test`）：Runtime、权限、未知工具、resume、stdio MCP
- `.github/workflows/ci.yml`
- `stdioMcpBackend`：同一套 `McpBackend`，子进程 JSON-RPC

验收：

```sh
pnpm build && pnpm test
```

## Phase 7 — Streaming CLI ✅

交付物：

- DefaultLoop 走 `llm.stream()`  
- `agent.assistant-stream`；`tah run` / `tah chat` 边收边打  
- OpenAI 兼容 SSE  

验收：

```sh
pnpm tah -- run --mock "你好"
npx tah --help
```

## Phase 8 — 约定式项目 ✅

不写启动代码，按约定放文件就能基于 `tah` 做自己的 Agent。设计见 [设计说明](https://github.com/MichaelVendor/typescript-agent-harness/blob/main/docs/design/project-convention.md)。

交付物：

- `AGENTS.md` 替换默认人设；`tools/<name>.ts`（`defineTool`）、`plugins/<name>.ts`（`definePlugin`）自动加载，工具名由文件名推导
- 只有 `package.json` 依赖 `@typescript-agent-harness/cli` 的目录才进入项目模式
- 有 `tools/` 时默认不挂内置工具（`--builtin-tools` 恢复）
- `tah init` 骨架；`examples/convention-agent`

验收：

```sh
pnpm demo:convention
mkdir my-agent && cd my-agent && npx @typescript-agent-harness/cli init && npx tah --mock chat
```

## Phase 9 — 终端 UI ✅（v0.24）

设计见 [TUI 与会话接口](/design/tui)。

交付物：

- 终端里 `tah chat` 进 Ink TUI：流式 Markdown、工具调用行、界面内审批、斜杠命令菜单、会话选择器、多行输入
- `ChatHost`（`packages/cli/src/host.ts`）：把 Runtime 事件转成纯 JSON 的 `HostEvent`，TUI 和网页共用
- 管道 / `--plain` 保留逐行模式

验收：

```sh
pnpm tah -- --mock chat
```

## Phase 10 — 本机网页工作台 ✅（v0.25）

设计见 [tah serve 与网页工作台](/design/serve)。

交付物：

- `tah serve`：只监听 `127.0.0.1`，HTTP + SSE 暴露 `ChatHost`；一次性令牌换 HttpOnly cookie，校验 `Host` / `Origin`
- `packages/web`（React + Vite，私有包）：功能与 TUI 对齐，产物随 CLI 发布
- 多个标签页同步同一个会话，断线重连后从服务端补齐

验收：

```sh
pnpm tah -- serve --mock
```

## Phase 11 — 约定式项目热更新 ✅（v0.26）

设计见 [约定式项目热更新](/design/reload)。

交付物：

- 终端 `tah chat` / `tah serve` 监听 `AGENTS.md`、`tools/`、`plugins/`、`lib/`；改动后重建 Runtime 并按 id 重开当前会话
- 一轮进行中改的等这一轮结束；加载失败继续用旧版本并提示原因
- `--no-watch` 关闭；`--no-persist` 只提示重启

验收：

```sh
pnpm demo:convention   # 另开终端改 examples/convention-agent/tools/ 里的文件
```

## Phase 12 — 附件（`tah serve`）✅（v0.27）

设计见 [附件](/design/attachments)。

交付物：

- `tah serve` 可上传文件 / 图片到 `<cwd>/.tah/attachments/`（内容寻址）；会话只存引用
- 默认把只读路径写进 user 文本，模型用工具按需读；`--vision` / `TAH_VISION=1` 时图片进多模态请求
- 网页草稿附件栏与历史卡片；TUI / `tah run` 不做

## Phase 13 — 项目配置（能力包）✅（v0.28）

设计见 [项目配置](/design/config)。

交付物：

- 约定式项目可选根目录 `tah.config.json`：`capabilities`（coding / web / vision）+ `extensions.mcp`
- 合并顺序：内置默认 → config → CLI / 环境变量；无文件时行为与 v0.27 一致
- `capabilities.web: true` 在官方联网工具落地前启动报错（v0.31 已落地 `web_fetch` / `web_search`）；浏览器自动化用 MCP（见 [CLI](/guide/cli.md)）；`tah init` 写入示例 config（仅 coding）

## Phase 14 — Skills ✅

设计见 [Skills](/design/skills)。

交付物：

- 发现与合并 `skills/`、`.agents/skills/`、`.cursor/skills/`、`~/.tah/skills/` 下的 `SKILL.md`（及扁平 `.md`）
- system prompt **catalog**（仅 model-invocable 的 name + description）；内置 **`skill`** 工具按需读正文
- 用户 **`/kebab-name`**（`tah chat` TUI / `tah serve`）；`disable-model-invocation` 技能仅 slash 入口
- 与 `AGENTS.md` / `tools/` 同类热更新；启动行 `skills+N`
- `tah init` 示例 `skills/hello/SKILL.md`

验收：

```sh
cd packages/cli && pnpm build && node --test --experimental-strip-types test/skills-*.test.ts
mkdir /tmp/tah-skill-demo && cd /tmp/tah-skill-demo && npx tah init && npx tah --mock chat   # 试 /hello
```

## Phase 15 — 工作文件夹 + Settings ✅（v0.30）

设计见 [工作文件夹](/design/workspaces)。

交付物：

- 侧栏按文件夹分组列出会话；打开、新建文件夹，切到别的文件夹的会话时 Agent 工作目录跟着换
- Settings：添加模型（名字、API key、可选 base URL）并选一个在用，存 `~/.tah/settings.json`（0600），优先于 `.env`；key 只进不出
- Settings → Skills：列出已加载的 skill，导入到 `~/.tah/skills`（v0.30.1）
- 连续的工具调用折叠成一块

## Phase 16 — 内置工具补齐 + 上下文压缩 ✅（v0.31）

交付物：

- `edit_file`（精确替换，需审批）、`todo_write`（任务列表，网页显示在输入框上方）
- `web_fetch`（不要 key，只取公网地址）、`web_search`（Tavily key；v0.37.4 起没 key 也能用，走 Exa + Bing）；`capabilities.web` 控制
- 内置浏览器：`browser_open` 获批后挂 `browser_*` 工具，驱动本机 Chrome（见 [内置浏览器](/design/browser)）
- 上下文超预算时先让模型总结早先的轮次，失败再裁剪；`/compact` 或网页 **Compact** 手动压缩

## Phase 17 — 网页参考 DeepSeek Harness ✅（v0.32）

交付物：

- 侧栏：搜索会话、按文件夹 / 平铺切换、每组先显示 5 个、收起成图标栏
- 输入框改成卡片式，发送按钮左边是模型按钮，按服务商列出已存模型和 `.env` 模型

## Phase 18 — 看图 ✅（v0.33）

设计见 [附件](/design/attachments)。

交付物：

- Settings 里每个模型可勾「能看图」；在用的模型决定图片附件是否直接发给模型（`.env` 模型仍看 `--vision`）
- 不能看图的模型：会话里的旧图片换成 `[image omitted]`，附件说明改为提示用 `read_image_text`
- `read_image_text`：macOS 用系统 OCR 识别中英文，跟内置文件工具一起挂；Windows / Linux 不提供

## Phase 19 — macOS 客户端 ✅（v0.35）

设计见 [macOS 客户端](/design/desktop)。

交付物：

- `apps/desktop`：Apple Silicon、本地打包 `.dmg`、不签名；窗口里跑 `tah serve`，自带 Node，命令拿到登录 shell 的 PATH
- 和命令行共用 `~/.tah`；打开时回到上次的文件夹；内核包不改

## Phase 20 — 文件预览 ✅（v0.35）

设计见 [文件预览](/design/file-preview)。

交付物：

- 工具行、附件卡片、Markdown 链接、像路径的行内代码可点，右侧面板只读预览，只限当前工作文件夹
- 图片 / PDF / 视频 / Markdown / 代码；HTML 在 sandbox 不透明来源里渲染，拿不到登录 cookie 和 `/api`
- 写、改文件或跑命令后自动刷新；新接口 `GET /api/files/stat`、`GET /api/files/raw`、`GET /preview/<令牌>/<路径>`

## Phase 21 — 浏览器面板 ✅（v0.36）

设计见 [浏览器面板](/design/browser-pane)。

交付物：

- `tah serve` 的内置浏览器改为无界面，画面经 CDP 截屏流进右侧面板；点击、滚动、键盘（含中文输入法）转发给 Chrome
- 入口：Agent 调 `browser_open`、对话里的 http(s) 链接、HTML 文件预览「Open in browser」、状态栏「Browser」
- 用户先打开浏览器不等于授权 Agent；面板不能打开 tah 自己的地址；新接口 `/api/browser*`

## Phase 22 — AgentHost ✅（v1.0）

设计见 [AgentHost 无头宿主](/design/agent-host)。

交付物：

- `tah agent-host`：`AR_SHARED_SECRET` + `--project-id` / `TAH_PROJECT_ID`，默认 `0.0.0.0:7800`
- `GET /health`；`GET /v1/info`、`/v1/sessions`；`POST /v1/sessions`；`POST /v1/sessions/:id/messages`（SSE `HostEvent`）；`POST …/cancel`
- 单进程内一个 `ChatHost`；跨 session 写前先 `resume`；忙时 **409**（不移植 serve 排队）
- `packages/cli/src/agent-host/*`；**不修改** `serve` 行为

验收：

```sh
pnpm --filter @typescript-agent-harness/cli build
node --test --experimental-strip-types packages/cli/test/agent-host*.ts
pnpm test   # 含 serve 回归
```

## Phase 23 — 内网控制面 ✅（v1.1）

设计见 [内网控制面](/design/control-plane)。

交付物：

- `apps/control`：cookie 会话、`POST /api/login`、项目与成员（SQLite）、`POST …/wake`
- Docker 一项目一容器（`tah-project-<id>`），不发布端口，`inspect` IP + 7800 访问 AgentHost
- `/api/projects/:id/agent/health` 与 `/api/projects/:id/agent/v1/*` 代理，短时 Bearer + SSE 透传；空闲 30 分钟 `docker stop`
- **不修改** `tah serve`

验收：

```sh
pnpm --filter @typescript-agent-harness/control test
```

## 非目标（刻意不做）

- Phase 1–3 不做 Electron / 完整 Web IDE  
- 不做插件市场  
- 不绑定单一模型厂商 SDK 作为内核依赖  
- 不把 prompt 工程当成 Runtime 的核心抽象  
- v0.28 不做内置浏览器自动化；不做官方 `web_search` / `web_fetch`（键位预留，实现另开）

## 版本策略

- `0.x`：API 可破坏性变更，文档与 CHANGELOG 同步  
- `main`：已发布代码；每个发布打 tag（当前开发分支 `v1.3`）  
- `v0.N` / `v1.N`：当前小版本的开发分支，合入 `main` 后打对应 `x.y.z` tag  
- `1.x`：可继续破坏性变更时在 CHANGELOG 写明；单机 `tah serve` 与无头 `tah agent-host` 并行，互不替换  
- 公共 API 以 `docs/api/*` 与包 `exports` 为准  
