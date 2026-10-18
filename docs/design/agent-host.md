# 设计说明：AgentHost 无头宿主（v1.0）

状态：✅ 已实现（`v1.0`）

## 背景

内网 SaaS（一项目一容器）需要控制面（CP）调用容器内的 Agent，而不是把本机工作台 `tah serve` 直接暴露出去。

分层与 `tah serve` 共用 **`ChatHost` + `HostEvent`**，只是 HTTP 层不同：

```text
packages/web → serve/http（本机 cookie·静态页·工作区·Settings·预览·浏览器）
                    → hub → ChatHost → Runtime
TUI ───────────────────────────────→ ChatHost
CP（Bearer）→ agent-host/http ───────→ ChatHost → Runtime（固定 cwd）
```

设计 spec：`docs/superpowers/specs/2026-10-18-agent-host-design.md`。

## 目标

- 容器内跑 **`tah agent-host`**：CP 签发的 Bearer、固定 `--cwd`、HTTP `/v1`、SSE 推送 **`HostEvent`**（与 TUI / serve 同一套 JSON）。
- **复用** `createChatHost`、审批与 `ask_user` 队列（HTTP 暴露审批 / 提问在 P1）；**不改动** `tah serve` / TUI 行为。
- 一进程一项目卷 → 一个 `ChatHost` → 多个 Session（SQLite 在 `<cwd>/.tah/cli.db`）。

## 非目标

- SSO、项目成员、容器编排、计费（控制面职责）。
- Cookie、`/api/auth`、`Host` / `Origin` 校验、静态网页、`packages/web`。
- Hub 多工作文件夹、Settings 写模型 key、Skills 导入 API、文件预览、`/preview/`、浏览器面板。
- 把 `/api/*` 1:1 搬进容器（serve 是「单当前会话 + 全局 SSE」；Host 是「按 session 路径 + 每轮 messages 一条 SSE」）。
- P1 再做：`GET /v1/sessions/:id` 快照、`continue` / `compact`、`answer` / `question` HTTP、忙时排队。

## 架构

```text
公司前端 → Gateway(SSO) → 控制面
                            │ 内网 Bearer（AR_SHARED_SECRET）
                            ▼
                     tah agent-host（容器）
                            │
                        ChatHost
                            │
                        Runtime（cwd = 项目卷）
```

| 模块 | 职责 |
| --- | --- |
| `packages/cli/src/host.ts` | `ChatHost`、`HostEvent`；TUI / serve / AgentHost 共用 |
| `packages/cli/src/agent-host/` | Bearer 校验、`/health`、`/v1/*`、SSE 写 `HostEvent` |
| `packages/cli/src/serve/` | 本机工作台（见 [tah serve 设计](./serve.md)） |

进程内仍是 **一个当前 Session**（与 TUI / serve 一致）。`POST …/sessions/:id/messages` 或 `cancel` 若 id ≠ 当前会先 `resume(id)`；**一轮进行中或正在切换 session 时**其它写操作返回 **409** `turn_in_progress`（CP 应对同一项目串行化写请求）。

## 鉴权

- 环境变量 **`AR_SHARED_SECRET`**（与 CP 共享，由编排注入）。
- 项目 id：**`--project-id`** 或 **`TAH_PROJECT_ID`**，须与 token 内 `projectId` 一致。
- Token 格式：`base64url(JSON claims).HMAC-SHA256`（`packages/cli/src/agent-host/auth.ts`）；claims 至少 **`projectId`**、**`userId`**、**`exp`**（unix 秒）；可选 **`sessionId`**（P0 路由不强制）。
- 错 secret、过期、**project 不匹配** → **401**，body `{ "error": string }`。
- **`GET /health`** 不鉴权，返回 `{ ok: true, projectId }`。

CP 侧用同一 secret 签发 token；测试里可用 `signAgentHostToken`（不对外承诺为公共 API）。

## HTTP `/v1`（P0 已实现）

除 `/health` 外，请求头 **`Authorization: Bearer <token>`**；JSON body 须 `Content-Type: application/json`。错误 `{ "error": string }`。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/health` | 探活；不鉴权 |
| `GET` | `/v1/info` | `{ approve, version, cwd }`（无 serve 的桌面 / maxSteps 字段） |
| `GET` | `/v1/sessions` | `listSessions()` → `SessionRow[]` |
| `POST` | `/v1/sessions` | `reset()` 新会话；可选 body `{ title? }` 改名；**201** `{ sessionId }` |
| `POST` | `/v1/sessions/:id/messages` | body `{ text }`；空消息 **400**；忙时 **409**；成功 **200** `text/event-stream`，推送本轮 `HostEvent`，以 **`turn.end`** 或 **`turn.error`** 结束并关闭流 |
| `POST` | `/v1/sessions/:id/cancel` | `cancel()`；**204**；目标 session 不是当前且进程忙时 **409** |

### SSE

每条 **`data:`** 一行 JSON，即一个 **`HostEvent`**（字段与 `host.ts` 一致，例如 `text` 流式增量是 `type: "text"`，不是 `assistant.delta`）。一轮结束以 **`turn.end`** 或 **`turn.error`** 为准，不另造事件名。

客户端断开 SSE 连接时，服务端会 **`cancel()`** 当前轮（与 serve 单连接语义不同，messages 流绑定这一轮）。

### 忙时（P0）

- 已有轮次进行中再 `POST …/messages` → **409** `turn_in_progress`（**不**排队；serve 的 `send` 排队与 `queue` 事件不在 AgentHost）。
- 正在 `resume` 切换 session 时，其它 `messages` → **409**（避免在旧 session 的 turn 未结束时切走）。

## 命令

```text
tah agent-host [--cwd <path>] [--host <addr>] [--port <n>] [--project-id <id>]
               [与 tah chat 相同的运行时参数：--mock --yes --max-steps --no-persist --allow --deny …]
```

- **`AR_SHARED_SECRET`**、**`--project-id` / `TAH_PROJECT_ID`** 必填，否则退出码 1。
- 默认 **`0.0.0.0:7800`**（`--port 0` 由系统分配，测试用）；**不是** serve 的 `127.0.0.1:7420`。
- 无 LLM key 时可启动（与 `tah serve` 相同），发消息时再失败；`--mock` 用于测试。
- 启动打印 `AgentHost listening on http://…`（无 cookie URL）。**Ctrl+C** 关连接并 `host.close()`。

容器示例：

```bash
export AR_SHARED_SECRET=… TAH_PROJECT_ID=proj_abc
tah agent-host --cwd /workspace --host 0.0.0.0 --port 7800
```

模型与能力来自 **环境变量** 与 **`tah.config.json`**（无 Settings API）。P0 只读场景可在 config 里 `permissions.deny` 写/执行类工具。

## 与 `tah serve` 对比

| | **`tah serve`** | **`tah agent-host`** |
| --- | --- | --- |
| 定位 | 本机工作台 + 网页 | 容器内无头 API |
| 监听 | `127.0.0.1` | 默认 `0.0.0.0` |
| 鉴权 | 启动令牌 → HttpOnly cookie；校验 Host / Origin | Bearer + `project_id` |
| 协议前缀 | `/api/*` | `/health`、`/v1/*` |
| 事件流 | 全局 `GET /api/events`，hub 多标签同步 | 每轮 `POST …/messages` 一条 SSE |
| 忙时发消息 | 排队（`queue` 事件） | **409** |
| 工作区 | 多文件夹 hub | 固定 `--cwd` |
| UI / Settings / 预览 / 浏览器 | 有 | 无 |

两者 **并行**，互不替换；改 AgentHost 不得改变 serve 路由与 cookie 行为。

## 测试

- `packages/cli/test/agent-host-auth.test.ts`：签发 / 校验、错 secret、错 project、过期。
- `packages/cli/test/agent-host.test.ts`：`/health`、401、sessions、messages SSE 顺序、`cancel`、409、跨 session `resume`。
- 回归：`packages/cli/test/serve.test.ts` 与既有 TUI 测试保持全绿。

## 文件

| 文件 | 作用 |
| --- | --- |
| `packages/cli/src/agent-host/auth.ts` | HMAC Bearer |
| `packages/cli/src/agent-host/sse.ts` | `HostEvent` → SSE |
| `packages/cli/src/agent-host/http.ts` | 路由 |
| `packages/cli/src/agent-host/run.ts` | `startAgentHost` / `runAgentHost` |
| `packages/cli/src/args.ts`、`cli.ts` | `tah agent-host` 入口 |
