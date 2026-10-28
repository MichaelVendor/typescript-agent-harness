# 设计说明：`tah serve` 与网页工作台（v0.25）

状态：✅ 已实现（`v0.25`）

## 背景

v0.24 定义了会话接口 `ChatHost`，TUI 在进程内调用它（见 [TUI 设计](./tui.md)）。v0.25 把同一个接口暴露成 HTTP + 事件流，再配一个网页前端：用户在浏览器里操作本机上的 Agent，读写文件、执行命令都由用户自己在网页上审批。定位和 Claude Code、Codex、DeepSeek Harness 的 `dsh web` 相同：**本机工作台，不是对外公开的服务**。

遵循的原则（见 [设计哲学](../guide/philosophy.md)、[整体架构](../guide/architecture.md)）：

- 界面属于 Application 层，Runtime 不内嵌 UI；`core` / `agent` / `tools` 等包不改。
- 前端只依赖契约（协议类型），不 import 实现——和插件只认 `ServiceKey` 是同一个思路。
- 界面状态必须能从事件重建。
- 不做用不到的东西。

## 目标

- `tah serve` 在本机起服务：提供 HTTP 命令接口 + SSE 事件流，并发网页静态文件；默认自动打开浏览器。
- 网页功能与 TUI 对齐：流式 Markdown、工具行、审批卡片、步数上限提示、会话侧栏（切换 / 新建 / 分叉）、多行输入、停止、状态栏、断线重连。
- 同一服务可开多个标签页，看到的是同一个会话，操作实时同步。

## 非目标

- 不对外公开：只监听 `127.0.0.1`，没有账号体系、限流、HTTPS。远程使用走 SSH 端口转发。
- 多会话并行（Claude 风格：子进程 worker + git worktree）见 [并行 Session 规格](../superpowers/specs/2026-10-28-parallel-sessions-design.md)（📐 已设计、未实现）。**当前实现**仍是同一时间只有一个当前会话，和 TUI 一样；多个文件夹见 [工作文件夹](./workspaces.md)（v0.30），仍然只有一个当前会话。
- 不做文件树、diff 查看、设置面板、主题切换、网页里切换审批模式（仍用 `--yes`）。
- 附件（选择 / 拖拽 / 粘贴文件与图片）见 [附件](./attachments.md)，不在本文件展开。
- 不引入服务端框架和 WebSocket：`node:http` + SSE。
- 不发布网页包：`packages/web` 是私有包，产物随 CLI 发布。

## 架构

```text
浏览器 (packages/web, React)            tah serve (packages/cli)
┌──────────────────────────┐   POST    ┌──────────────────────────┐
│ 只认协议类型               │ ───────▶  │ serve/http.ts  路由、鉴权  │
│ HostEvent / 命令请求体     │   SSE     │ serve/hub.ts   多标签页同步 │
│ （import type）           │ ◀───────  │ host.ts        ChatHost   │
└──────────────────────────┘           └────────────┬─────────────┘
                                                    │ 进程内
                                               Runtime（不变）
```

- **`packages/cli`**（应用层）：新增 `src/serve/`。`http.ts` 用 `node:http` 写路由、鉴权、静态文件；`hub.ts` 让一个 `ChatHost` 服务多个标签页。
- **`packages/web`**（新包，`"private": true`）：React + Vite。只通过 `import type` 引用 `@typescript-agent-harness/cli` 导出的协议类型。Vite 产物输出到 `packages/cli/dist/web/`，跟着 CLI 发布；CI 的 `publish` 自动跳过私有包。产物写进 cli 目录是唯一跨包的地方，它是构建产物，不是代码依赖。

## 契约改动（`packages/cli/src/host.ts`）

1. **导出协议类型。** `src/index.ts` 导出 `HostEvent`、`HistoryItem`、`SessionRow`、`ApprovalAnswer` 和命令请求体类型 `ServeRequest`（各接口的请求体）。
2. **`historyTurns` 选项。** `createChatHost(flags, { historyTurns })`：TUI 传 3（现状），serve 传 `Infinity`（网页没有终端滚动区，切会话要看全部）。
3. **新事件 `user {text}`。** `send(text)` 开始一轮时发出。现在 TUI 在本地显示用户消息，其他标签页看不到；改成事件后所有前端共用。
4. **新事件 `approval.end {id, answer}`。** 审批被答复（包括 `cancel()` / 中止时按 `no` 处理）时发出。一个标签页答复后，其他标签页的卡片随之消失。
5. **新方法 `snapshot()`。** 返回当前会话的 `session` 事件（`resumed: true`，历史按 `historyTurns`），供 hub 生成基准快照。

TUI 改为使用 `user` / `approval.end` 事件，删掉 `Transcript.user()` 里的本地追加和 `clearApproval()`，所有前端走同一套事件。

改动后的事件表：

```ts
type HostEvent =
  | { type: "session"; id: string; resumed: boolean; history: HistoryItem[]; hiddenTurns: number; todos?: Todo[] }
  | { type: "user"; text: string }
  | { type: "text"; delta: string }
  | { type: "tool.start"; callId: string; tool: string; summary: string }
  | { type: "tool.end"; callId: string; tool: string; summary: string; ok: boolean; result: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "approval"; id: string; tool: string; input: unknown }
  | { type: "approval.end"; id: string; answer: ApprovalAnswer }
  | { type: "notice"; text: string }
  | { type: "turn.end"; state: string; finishReason: string; rounds: number; model?: string; usage?: TokenUsage; sessionUsage?: TokenUsage }
  | { type: "turn.error"; cancelled: boolean; message: string };
```

## 协议

### 接口

全部要求已登录（`/api/auth` 除外）；请求体和响应体都是 JSON，错误响应为 `{ error: string }`。

| 接口 | 作用 | 成功 |
| --- | --- | --- |
| `POST /api/auth` `{token}` | 启动令牌换 cookie | 204 |
| `GET /api/info` | `{approve, maxSteps, version}` | 200 |
| `GET /api/events` | SSE，每条 `data:` 是一个 `HostEvent` | 长连接 |
| `GET /api/sessions` | `SessionRow[]` | 200 |
| `POST /api/send` `{text}` | 发消息；一轮进行中排队（v0.37.3，见 [忙时排队发消息](./queue.md)） | 202 |
| `POST /api/queue` `{id, send: true}` / `{id, remove: true}` | 立即发出（空闲时，忙时 409）/ 删除一条排队的消息 | 204 |
| `POST /api/continue` | 步数上限后继续同一轮 | 202 |
| `POST /api/compact` | 把到目前为止的对话压缩成摘要；按一轮处理（忙时 409，`/api/cancel` 可中止，结束发 `turn.end`） | 202 |
| `POST /api/cancel` | 停止当前轮 | 204 |
| `POST /api/answer` `{id, answer}` | `answer`：`yes` / `always` / `no` | 204 |
| `POST /api/reset` | 新会话 | 204 |
| `POST /api/resume` `{ref}` | 切到会话（id 或列表序号） | 204 |
| `POST /api/fork` `{turns?}` | 从当前会话分叉 | 204 |

工作文件夹（v0.30）另加 `GET /api/workspaces`、`GET /api/workspaces/recent`、`POST /api/workspaces/add|remove`、`GET /api/fs`、`POST /api/fs/mkdir`、`POST /api/fs/choose`（系统选文件夹对话框），`reset` / `resume` / `fork` / `rename` / `session-flag` 可带 `cwd`，见 [工作文件夹](./workspaces.md)。

模型设置（v0.30）：

| 接口 | 作用 |
| --- | --- |
| `GET /api/settings` | `{ user, models: [{ id, model, baseURL, keyHint, vision }], activeModel, env, search }`；`vision` 表示模型能看图（v0.33）；`user` 是电脑用户名；`env` 是 `.env` / 环境变量给出的 `{ model, key }`（`key` 是变量名 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`，不是 key 本身），没有 key 时为 `null`（v0.32）；`search` 是 `{ source: "settings" \| "env", keyHint }` 或 `null` |
| `POST /api/settings/models` `{model, apiKey, baseURL?, vision?}` | 添加模型；第一个自动选中 |
| `POST /api/settings/models/remove` `{id}` | 删除；删的是选中的就退回 `.env` |
| `POST /api/settings/models/vision` `{id, vision}` | 标记模型能不能看图（v0.33）；`vision` 必须是布尔值 |
| `POST /api/settings/active` `{id \| null}` | 选中模型；`null` 用 `.env` |
| `POST /api/settings/search` `{apiKey \| null}` | 保存 Tavily key（`web_search` 改用 Tavily，v0.31）；`null` 删除，退回 `.env` 的 `TAVILY_API_KEY`，都没有时用 Exa + Bing（v0.37.4）；host 重新加载 |

Skills（v0.30.1）：`GET /api/skills` 列出当前文件夹加载的 skill（`source`: `home` / `folder`）；`POST /api/skills/import` `{path}` 把一个 skill 文件夹（或一层子文件夹里的全部 skill）复制进 `~/.tah/skills`，返回列表加 `imported` / `skipped`；`POST /api/skills/remove` `{name}` 只删 `~/.tah/skills` 里的。导入 / 删除后 host 重新加载；一轮进行中返回 409。见 [Skills](./skills.md#网页导入-v0-30-1)。

文件预览（v0.35）：`GET /api/files/stat?path=…`（或 `?attachment=<id>`）返回 `FileStat`；`GET /api/files/raw` 返回文件字节（支持 `Range`）；`GET /preview/<预览令牌>/<相对路径>` 给 HTML 预览用（不需要登录，CSP sandbox）。都只读、只限当前工作文件夹，见 [文件预览](./file-preview.md)。

浏览器面板（v0.36）：`GET /api/browser` 返回 `BrowserState`；`GET /api/browser/stream` 是 SSE（`state` 和截屏 `frame`）；`POST /api/browser/open`（`{ url? }`）、`/nav`（`{ action: "back" | "reload" }`）、`/tab`（`{ id }`）、`/input`（`BrowserInput`）、`/dialog`（`{ accept, text? }`，回应网页对话框）、`/close`。都要登录；`open` 不接受 tah 自己的地址（`/preview/` 除外）。见 [浏览器面板](./browser-pane.md)。

上面设置的五个 POST 都返回新的 `GET /api/settings` 结果。模型存在 `~/.tah/settings.json`（权限 0600），所有文件夹共用；选中的模型优先于 `.env`。不填 `baseURL` 时，名字以 `deepseek` 开头用 `https://api.deepseek.com/v1`，否则用 `https://api.openai.com/v1`。API key 只进不出：网页只拿到 `keyHint`（如 `sk-…abcd`）。选中的模型（或它的 `vision`）变了，当前文件夹的 host 重新加载（会话保留，下一轮生效）；一轮进行中返回 409。没有任何 key 时 `tah serve` 照常启动，发消息时报「no model configured」。

规则：

- `send` / `continue` 返回 202 即结束，结果全走事件流。网页只有一个数据来源。
- 一轮进行中调 `continue` / `reset` / `resume` / `fork` 返回 409；`send` 排队（v0.37.3）。忙闲由 hub 记录：hub 调 `send` / `continueTurn` 时、或收到 `user` 事件（host 自动发出排队消息）时置忙，收到 `turn.end` / `turn.error` 时置闲。
- 请求体格式错误 400；未登录 401；`Host` / `Origin` 不符 403；`--no-persist` 下会话列表、改名、置顶 / 归档、`/api/workspaces` 与带 `cwd` 的请求 409；切换文件夹进行中再切换 409；`ChatHost` 命令抛出的其他错误（如 `resume` 找不到会话）400，`error` 为原错误信息。
- 未知路径：`/api/*` 返回 404 JSON；其他路径按静态文件处理（见下）。

### 静态文件

- `GET /` 和不带扩展名的路径返回 `dist/web/index.html`；其他路径从 `dist/web/` 读文件，路径解析后必须仍在 `dist/web/` 内，否则 404。
- `dist/web/` 不存在（源码运行但没构建网页）：API 照常，页面请求返回 503 文本 `web UI not built — run pnpm build`。

### 新连接拿到完整状态

hub 维护：

- **启动提示**：`open()` 发出的 `notice`。
- **基准快照**：最近一次 `session` 事件。收到 `session` 事件（打开、`reset` / `resume` / `fork`）时替换并清空本轮事件；每轮结束（`turn.end` / `turn.error`）后调 `host.snapshot()` 刷新并清空本轮事件，此时历史已包含刚结束的这一轮。
- **本轮事件**：基准快照之后的所有事件；连续的 `text` 合并成一条，`approval.end` 到达时去掉对应的 `approval`。

新的 SSE 连接依次收到：启动提示 → 基准快照 → 本轮事件，然后接收实时事件。每 15 秒发一行 SSE 注释（`: ping`）作心跳。

### 安全

防的是本机其他网页和程序冒充用户操作 Agent。

- 只绑定 `127.0.0.1`，不提供其他监听地址。
- 每次启动用 `crypto.randomBytes(32)` 生成令牌（base64url），比较用 `timingSafeEqual`。
- 终端打印 `http://127.0.0.1:<port>/?token=<token>`。网页读到 `?token=` 后调 `POST /api/auth`，服务端设置 cookie `tah_token_<port>=<token>; HttpOnly; SameSite=Strict; Path=/`（cookie 不区分端口，名字带上端口，两个项目同时 `tah serve` 才不会互相顶掉登录）；网页用 `history.replaceState` 去掉地址栏里的令牌。换 cookie 走 API 而不是静态页，所以 Vite 开发服务器代理时也能用。
- 所有请求校验 `Host` 头为 `127.0.0.1:<port>` 或 `localhost:<port>`（防 DNS 重绑定）。
- 所有 POST 校验 `Origin` 为同一地址，且 `Content-Type: application/json`（防跨站请求伪造）。
- 文件夹选择器（`GET /api/fs`）能列出当前用户可读的任意目录下的文件夹名（不列文件），`POST /api/fs/mkdir` 能在可写目录下新建文件夹，`POST /api/fs/choose` 会在本机弹出系统对话框，同样受上面的令牌保护。
- `~/.tah/settings.json` 明文存 API key，只有当前用户可读写（0600）；接口从不返回完整 key。
- 打开一个文件夹会加载它的 `tools/`、`plugins/`、`skills/` 与 `tah.config.json`，和在那里跑 `tah chat` 一样会执行其中代码；只添加信任的文件夹。
- 文件预览接口只读、只限当前工作文件夹（`realpath` 后比较，软链接不能指向外面）；HTML 预览在 sandbox 不透明来源里运行，拿不到登录 cookie、调不了 `/api`，但能用预览令牌加载这个文件夹里的文件（图片、样式、脚本；`fetch()` 读不到内容）。只预览信任的 HTML。
- 浏览器面板：Chrome 的调试端口只监听 `127.0.0.1`；面板不能打开 tah 自己的地址（`/preview/` 除外），Agent 的浏览器拿不到登录 cookie；用户在面板里的输入不写日志、不进会话。

## 命令

```text
tah serve [--port <n>] [--no-open] [chat 的现有参数：--yes --max-steps --no-persist --session --mock …]
```

- 默认端口 7420；被占用时报错 `port 7420 in use — pass --port <n>`，退出码 1，不自动换端口。`--port 0` 由系统分配（测试用）。
- 默认用系统命令打开浏览器（macOS `open`、Linux `xdg-open`、Windows `start`），失败只提示不报错；`--no-open` 关闭。
- 在当前目录加载约定式项目，与 `tah chat` 相同。
- Ctrl+C：停止当前轮、关闭所有 SSE 连接、`host.close()`，打印 `session … saved — continue with: tah chat --session …`；再按一次强制退出。

## 网页（`packages/web`）

### 布局

- 左侧栏（v0.32 起参考 DeepSeek Harness）：顶部 tah 标志和收起按钮；「New session」；「Workspaces」标题旁是搜索、视图选项（按文件夹分组 / 平铺成一个列表）、添加文件夹。按文件夹分组时每组先显示 5 个会话，其余点「Show N more」，当前会话总会显示；悬停文件夹行出现 `+`（在该文件夹新建会话）和 `⋯`（从列表移除）。当前会话一轮进行中显示转圈，等审批时显示橙点和「needs approval」。搜索匹配会话标题和文件夹名，跨文件夹列出，命中处高亮。收起后是 56px 图标栏（展开、新建、搜索、添加文件夹、设置）；收起状态和分组方式存在浏览器 `localStorage`。分叉在会话右键菜单里。
- 主区域：消息流 + 底部输入框 + 状态栏（文件夹、会话 id、本轮轮数、本会话累计 `in` / `out` token，`--yes` 时显示 `approve=off`）。模型没回报 usage 时不显示 token。
- 输入框（v0.32 起参考 DeepSeek Harness）：卡片式，上面是文字，下面一行左边 `+` 附件，右边模型按钮和圆形发送（一轮进行中变停止）。模型按钮显示在用的模型（没选时显示 `.env` 的模型加「· .env」，都没有时「No model」）；点开按服务商分组列出已存模型（官方地址显示 DeepSeek / OpenAI，其他显示域名），有 `.env` key 时多一组「From .env」，底部「Manage models…」打开设置。选中即 `POST /api/settings/active`，对所有会话生效；一轮进行中按钮置灰。
- 颜色跟随系统亮 / 暗色；一个 CSS 文件，不用 UI 组件库。

### 状态

- 纯函数 `applyEvent(state, event)` 把 `HostEvent` 变成界面状态，`useReducer` 驱动；职责同 TUI 的 `Transcript`。
- 文本增量按 `requestAnimationFrame` 合并，每帧最多重绘一次。
- 只有 `api.ts` 与服务端通信（`fetch` + `EventSource`）；组件不直接发请求。
- 重连时 `EventSource` 自动重连，重连成功后清空状态，用服务端补发的事件重建。

### Markdown 与安全

- `react-markdown` + `remark-gfm` + `rehype-highlight`。
- **不渲染原始 HTML**：不用 `rehype-raw`、不用 `dangerouslySetInnerHTML`。模型输出可能夹带从文件里读到的 HTML，而这个页面能批准命令执行。

### 交互

- 输入框自动增高；Enter 发送，Shift+Enter 换行；输入法组字中（`isComposing`）Enter 不发送。
- 运行中发送按钮变成"停止"（`/api/cancel`）。
- 审批卡片由网页按 `approval.input` 渲染：`execute_command` 显示命令行，`write_file` 显示路径和前 8 行预览，`edit_file` 显示路径和 `-` 原文 / `+` 新文本，其他工具显示参数 JSON。按钮：允许一次 / 总是允许 / 拒绝。
- 步数上限：`turn.end` 的 `finishReason` 为 `max_steps` 时显示"继续""停止"。
- 任务清单：`todo_write` 成功后 host 发 `todos`（整份清单）；`session` 事件带上整个会话里最后一次成功的清单（从消息里推出来，不另存状态），所以刷新、恢复会话后清单还在。网页在输入框上方显示"Tasks 完成数/总数"面板，可折叠（折叠时显示进行中的那一项），全部完成后隐藏。
- 断线时顶部提示"重新连接中…"；未登录（401）时提示"请打开 tah serve 在终端里打印的链接"。
- 命令失败（4xx）在消息流里显示一条红色提示。

### 文件与依赖

- `src/main.tsx`、`App.tsx`、`api.ts`、`state.ts`、`styles.css`；`src/components/`：`Sidebar`、`Messages`、`ToolLine`、`ApprovalCard`、`Composer`、`ModelPicker`、`StatusBar`。
- 依赖：`react`、`react-dom`、`react-markdown`、`remark-gfm`、`rehype-highlight`；开发依赖：`vite`、`@vitejs/plugin-react`、`typescript`、`@types/react`、`@types/react-dom`。全部打进静态产物，CLI 用户不安装。
- 开发：`tah serve --no-open` 起服务，`packages/web` 里 `pnpm dev`，Vite 把 `/api` 代理到 `127.0.0.1:7420`。

## 文件

| 文件 | 改动 |
| --- | --- |
| `packages/cli/src/host.ts` | `historyTurns`、`snapshot()`、`user` / `approval.end` 事件 |
| `packages/cli/src/index.ts` | 导出协议类型 |
| `packages/cli/src/serve/http.ts`（新） | 路由、鉴权、静态文件、SSE |
| `packages/cli/src/serve/hub.ts`（新） | 基准快照 + 本轮事件、忙闲、广播 |
| `packages/cli/src/serve/run.ts`（新） | `runServe(flags)`：起服务、打开浏览器、Ctrl+C 收尾 |
| `packages/cli/src/cli.ts`、`args.ts` | `serve` 命令、`--port`、`--no-open`、用法说明 |
| `packages/cli/src/tui/transcript.ts`、`app.tsx` | 改用 `user` / `approval.end` 事件 |
| `packages/web/**`（新） | 网页 |
| 根 `package.json` | `build` 加上 web 包（在 cli 之后） |
| `docs/guide/cli.md`、`roadmap.md`、`CHANGELOG.md` | 用法说明 |

## 错误处理

| 情况 | 表现 |
| --- | --- |
| 启动前出错（没有 key、项目文件错误） | 不起服务，打印方式同 `tah chat`，退出码 1 |
| 端口被占用 | `port <n> in use — pass --port <n>`，退出码 1 |
| 网页未构建 | API 正常，页面 503 + 提示 |
| 命令失败 | 400 / 409 + `{error}`，网页显示红色提示 |
| 一轮失败 / 被取消 | 沿用 `turn.error` |
| 关掉浏览器 | 服务和正在跑的这一轮继续；待审批的请求一直等到某个标签页答复，不设超时 |
| 终端 Ctrl+C | 见"命令" |

## 测试

- `packages/cli/test/serve.test.ts`：`--mock --port 0` 起真实服务，用 `fetch` 测：
  - 无 cookie 401；令牌换 cookie；错误 `Host` / `Origin` 403；
  - 发消息后 SSE 事件顺序：`user` → … → `turn.end`；
  - 进行中再 `send` 排队，新连接回放队列，`/api/queue` 发出 / 删除；
  - 一轮进行到一半时新建 SSE 连接，收到快照 + 本轮事件；
  - 一个连接答复审批，两个连接都收到 `approval.end`；
  - 静态文件路径不能越出 `dist/web/`。
- `host.test.ts`：`user`、`approval.end`、`snapshot()`、`historyTurns`。
- TUI 现有测试改用新事件后全部通过。
- `packages/web/test/state.test.ts`：`applyEvent`（`node --test --experimental-strip-types`）。
- 手工：真实浏览器里发消息、审批、切换会话、刷新恢复、两个标签页同步。

## 已定决策

| 问题 | 决定 |
| --- | --- |
| 定位 | 本机工作台（同 `dsh web` / Claude Code / Codex），不对外公开 |
| 会话 | 同一时间一个当前会话，多标签页同步 |
| 前端 | React + Vite |
| 代码位置 | 新私有包 `packages/web`，只依赖 cli 导出的协议类型；产物进 `packages/cli/dist/web` |
| 通信 | POST 命令 + SSE 事件，`node:http`，不用框架 |
| 命令 | `tah serve`，默认端口 7420，自动打开浏览器 |
| 安全 | 只绑 `127.0.0.1`、一次性令牌换 HttpOnly cookie、校验 `Host` / `Origin` |
| 第一版范围 | 与 TUI 对齐（见"网页"）；历史在网页里显示全部 |
| 分支 | 从 `v0.24` 开 `v0.25` |
