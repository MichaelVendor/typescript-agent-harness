# AgentHost：从 `tah serve` 抽出的无头宿主

状态：✅ 已实现（`v1.0`）；用户向说明见 [AgentHost 设计](/design/agent-host)；实现计划见 `docs/superpowers/plans/2026-10-18-agent-host.md`

## 背景

内网 SaaS（一项目一容器）需要控制面（CP）调用容器内的 Agent，而不是把本机工作台 `tah serve` 直接暴露出去。

今天的分层已经清楚：

```text
packages/web → serve/http（本机鉴权·静态页·工作区·Settings·预览·浏览器面板）
                    → hub → ChatHost（host.ts）→ Runtime
TUI ─────────────────────────────────→ ChatHost
```

抽 Host 时轴心是 **`ChatHost` + `HostEvent`**，不是整份 `serve/http.ts`。

相关前文：`docs/superpowers/specs/` 外的产品结论（内网 SaaS、P0 只读工具、CP↔AR `/v1`）见对话记录；本文件把 **内核侧 AgentHost** 钉死。

## 目标

- 容器内跑 **AgentHost**：Bearer 鉴权、固定 cwd、HTTP `/v1`、SSE 推送 `HostEvent`。
- **复用**现有 `createChatHost` / `HostEvent` / 审批与 `ask_user` 队列；TUI 与 `tah serve` 行为不回归。
- `tah serve` **保留**为本机工作台；不删除 web / workspaces / settings / browser pane。

## 非目标

- SSO、项目成员、容器编排、计费（控制面）。
- 把 `/api/*` 1:1 搬进容器（serve 是「单当前会话 + 全局 SSE」；Host 是「多 session + 按 session 订阅」）。
- OS sandbox / gVisor（容器承担）；本设计可另开「workspace 路径死守」但不阻塞 Host HTTP。
- P0 不做：附件、文件预览、浏览器面板、Settings 写模型 key、Skills 导入 API、多工作文件夹。

## 架构

```text
公司前端 → Gateway(SSO) → 控制面
                            │ 内网 Bearer
                            ▼
                     AgentHost（容器）
                            │
                        ChatHost
                            │
                        Runtime（cwd = 项目卷）
```

| 模块 | 职责 |
| --- | --- |
| `packages/cli/src/host.ts`（现有） | `ChatHost`、`HostEvent`；TUI / serve / AgentHost 共用 |
| 新增 `packages/cli/src/agent-host/`（或日后独立包） | HTTP `/v1`、Bearer、SSE 映射、一进程一项目 cwd |
| `packages/cli/src/serve/` | 本机 cookie、hub 多 cwd、Settings、预览、browser pane、静态资源 |

进程模型：**一项目一容器 → 一 AgentHost 进程 → 一个固定 `cwd` → 多个 Session**（SQLite 在项目卷）。不必移植 `hub` 的多工作区切换；若需多标签同步，CP 或容器内对同一 `ChatHost` 事件做 fan-out 即可。

入口示例（实现时再定 flag 名）：

```bash
node … agent-host --cwd /workspace --listen 0.0.0.0:7800
# AR_SHARED_SECRET 来自编排注入
```

## 鉴权

- AgentHost **只认** CP 签发的 Bearer（HMAC/JWT，共享 `AR_SHARED_SECRET`）。
- Claims 至少含：`project_id`（须与容器启动配置一致）、`user_id`、`exp`；可选 `session_id`、`scopes`。
- **不实现** `/api/auth`、cookie、`Host: 127.0.0.1` 校验——那些留在 serve。
- 健康检查 `GET /health`：可不鉴权或仅探针网段（实现时二选一，文档写死）。

## HTTP `/v1`（P0）

全部 JSON；错误 `{ "error": string, "code"?: string }`。除 `/health` 外需要 Bearer。

| 方法 | 路径 | 行为（映射 ChatHost） |
| --- | --- | --- |
| `GET` | `/health` | `{ ok, projectId, revision? }` |
| `GET` | `/v1/info` | `{ approve, version, cwd }`（无桌面字段） |
| `GET` | `/v1/sessions` | `listSessions()` |
| `POST` | `/v1/sessions` | 体内可选 `{ title?, userId? }` → 等价 `reset()` 得到新会话并返回 id（或先 `reset` 再 rename）；`userId` 若暂无 Session 元数据则只进审计/日志 |
| `GET` | `/v1/sessions/:id` | `resume(id)` 后 `snapshot()`，**不**改变「当前会话」语义时需约定：见下方「多 session」 |
| `POST` | `/v1/sessions/:id/messages` | `Accept: text/event-stream`；body `{ text, clientMessageId? }` → `send(text)`；SSE 推送该轮相关 `HostEvent` |
| `POST` | `/v1/sessions/:id/cancel` | `cancel()` |
| `POST` | `/v1/sessions/:id/continue` | `continueTurn()`（P0 可选） |
| `POST` | `/v1/sessions/:id/compact` | `compact()`（P0 可选） |

### P1 再加

| 方法 | 路径 | ChatHost |
| --- | --- | --- |
| `POST` | `/v1/sessions/:id/answer` | `answer` / `answerQuestion` / `skipQuestion` |
| `POST` | `/v1/sessions/:id/fork` | `fork` |
| `POST` | `/v1/sessions/:id/rename` 等 | rename / session-flag |

### 多 session 与「当前会话」

现有 `ChatHost` 是 **单当前会话**（与 TUI/serve 一致）。AgentHost P0 两种实现选一，**本设计选定 A**：

- **A（选定）**：进程内仍一个 `ChatHost`；`POST/GET …/sessions/:id/*` 若 id ≠ 当前则先 `resume(id)` 再执行。并发两路打不同 session 时后写获胜或返回 `409 session_busy`（推荐 **409**，CP 串行化同一项目的写操作）。
- **B（不做）**：每 session 一个 ChatHost——改动大，P0 不值得。

列表与创建不经过「错误 id」时无需 resume。

### 忙时策略（P0）

- `messages`：若当前轮进行中 → **409** `turn_in_progress`（不强制移植排队；减少 CP 状态机）。
- 日后若要排队，再对齐 serve 的 `queue` 事件与 `sendQueued`。

## `HostEvent` → SSE 契约（v1）

SSE：每条 `data:` 一行 JSON，即一个 **HostEvent**（字段与 `host.ts` 一致，便于 CP 透传或薄封装）。

可选信封（推荐，便于多路复用与审计）：

```ts
type SseEnvelope = {
  sessionId: string;
  event: HostEvent; // 现有联合类型，不改名
};
```

P0 若 messages 的 SSE 已绑定 `:id`，可只推 `HostEvent`；**CP 长连接场景**用信封。两种模式字段不分裂：`event` 永远是 HostEvent。

### 事件表（与代码对齐）

| `type` | 主要字段 | 前端/CP 用途 |
| --- | --- | --- |
| `session` | `id, resumed, history, hiddenTurns, todos?` | 快照 / 切会话 |
| `user` | `text, attachments?` | 用户气泡 |
| `text` | `delta` | 助手流式 |
| `tool.start` | `callId, tool, summary, path?` | 工具开始 |
| `tool.end` | `callId, tool, summary, ok, result, path?` | 工具结束 |
| `todos` | `todos` | 任务列表 |
| `approval` | `id, tool, input` | P1 审批卡 |
| `approval.end` | `id, answer` | 审批结束 |
| `question` | `id, questions` | P1 ask_user |
| `question.end` | `id` | 提问结束 |
| `notice` | `text, error?` | 提示 |
| `retry` | `text` | 重试中 |
| `queue` | `items` | P0 不用则可不出现 |
| `turn.end` | `state, finishReason, rounds, model?` | 一轮正常结束 |
| `turn.error` | `cancelled, message` | 一轮失败/取消 |

一轮 `messages` 流的结束：以收到 `turn.end` 或 `turn.error` 为准；可再发 SSE 注释或空 `event: done`（实现时二选一，**推荐不另造事件**，避免与 HostEvent 分叉）。

### 与先前草图事件名的关系

对话里曾用 `assistant.delta` / `tool.start` 等——**实现以现有 `HostEvent.type` 为准**（`text` 不是 `assistant.delta`），避免维护两套。CP 若要对外改名，在控制面映射。

## 从 serve 抽出 / 留下

### 进入 AgentHost

- `ChatHost` 全部会话与回合方法（send/cancel/continue/compact/reset/resume/fork/list/rename/flags）。
- `HostEvent` 流。
- `approvalQueue` / `questionQueue`（P1 暴露 HTTP）。
- `bootRuntime` 装配（能力来自环境 / `tah.config.json`，非网页 Settings）。
- 项目卷上的 SQLite 持久化。

### 留在 `tah serve`

- `/api/auth`、cookie、本机 Host/Origin。
- `packages/web` 静态资源、hub 多工作区。
- workspaces / fs / choose 文件夹。
- Settings（模型、Tavily key）、Skills 导入删除 API。
- 文件预览、`/preview/`、浏览器面板与 CDP。
- 桌面壳相关字段与行为。

## P0 工具与配置

容器启动时建议：

- `capabilities.web`：可开（只读搜/读页）。
- **关闭或 deny**：`write_file`、`edit_file`、`execute_command`、`browser_*`（P0 只读）。
- 模型 key：仅环境变量，无 Settings API。

## 测试与验收

- 单测：Bearer 校验（错 secret / 过期 / 错 `project_id` → 401）；`resume` 冲突 → 409。
- 集成：mock LLM 下 `messages` SSE 依次出现 `user` → `text*` → `turn.end`；`cancel` 后得 `turn.error` 且 `cancelled: true`。
- 与 serve 回归：现有 `serve.test.ts` / TUI 相关测试全绿（ChatHost 行为不因导出 AgentHost 而改）。
- 手动：两容器两项目，CP token 不能跨项目；卷持久化后重启 Host 能 `listSessions` / 续聊。

## 实现顺序（供后续 writing-plans）

1. 文档化并导出稳定的 `HostEvent`（已存在；补 AgentHost 用 OpenAPI/Markdown 表即可）。
2. `agent-host` 模块：listen、Bearer、`/health`、`/v1/sessions*`、`messages` SSE。
3. CLI 入口（如 `tah agent-host`）或镜像 `CMD`。
4. 不改 serve；可选：共享「把 HostEvent 写成 SSE」的小函数供 serve 与 agent-host 共用。
5. P1：answer/question HTTP；忙时排队可选。

## 风险

- **单 ChatHost + resume**：并发多 session 写依赖 CP 串行或 409——需在 CP 文档写明。
- **事件契约**：前端/CP 依赖 `type` 字符串；破坏性变更走 0.x CHANGELOG。
- **误把 serve 当 Host**：审查 PR 时拒绝移植 cookie/workspaces/settings。
