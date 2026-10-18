# 控制面 P0 设计

状态：📐 设计（未实现）；开发分支 `v1.1`

## 背景

`tah agent-host`（v1.0）已经能在容器里用 Bearer 提供 `/v1`。内网 SaaS 还缺控制面：登录、项目成员、拉起容器、把浏览器请求转到对应的 AgentHost。`tah serve` 仍是本机工作台，不改。

已定：一项目一容器；浏览器只打控制面；AgentHost 只认控制面签发的短时 Bearer。

## 目标（P0）

- 新包 `apps/control`：Node HTTP 服务，只绑内网地址。
- 开发登录：用户名 + 密码（文件里的用户表）。接口形状留给以后换成公司 OIDC，P0 不接真实 SSO。
- 项目：创建、列表、成员（`owner` / `member`）。成员才能看见项目、发消息。
- 编排：第一次进入项目时 `docker run` 一个容器，里面跑 `tah agent-host`；工作区是该项目独占的卷；空闲一段时间后停容器（卷保留）。
- 代理：`/api/projects/:id/...` 转到该容器的 `/health` 与 `/v1/*`，并附上短时 HMAC Bearer（`projectId`、`userId`、`exp`）。
- 审计日志：谁、哪个项目、哪条路由、状态码、时间。不记录消息全文。

## 非目标

- 公司 OIDC / LDAP、计费、配额 UI、K8s。
- AgentHost 的审批 HTTP、`continue` / `compact`、会话快照（仍是内核 P1）。
- 浏览器面板、写文件、跑命令。P0 容器启动参数带 `--yes` **且** 项目 `tah.config.json` 建议 `permissions.deny` 写与执行类工具；控制面不提供审批界面。
- 改 `tah serve` / TUI。

## 架构

```text
浏览器 → apps/control（cookie 会话）
            │  docker run / stop
            │  HTTP + 短时 Bearer
            ▼
         项目容器：tah agent-host --cwd /workspace
            卷：<data>/projects/<id>/workspace
```

| 模块 | 职责 |
| --- | --- |
| `apps/control/src/auth.ts` | 密码校验、会话 cookie |
| `apps/control/src/store.ts` | 用户、项目、成员、审计（SQLite 一个文件） |
| `apps/control/src/docker.ts` | 起停容器、健康检查；测试注入假实现 |
| `apps/control/src/proxy.ts` | 签 Bearer，转发 `/v1` 与 SSE |
| `apps/control/src/http.ts` | 路由 |

数据目录：`CONTROL_DATA`（默认 `./.control-data`）。AgentHost 镜像：`CONTROL_IMAGE`（默认本地构建的 `tah-agent-host`）。共享密钥：`AR_SHARED_SECRET`，同一值注入每个容器。模型 key：`DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY` 从控制面环境注入容器，不进 API 响应。

## HTTP（给浏览器）

除 `POST /api/login` 外都要会话 cookie。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `POST` | `/api/login` `{ username, password }` | 成功设 HttpOnly cookie |
| `POST` | `/api/logout` | 清 cookie |
| `GET` | `/api/me` | 当前用户 |
| `GET` | `/api/projects` | 我是成员的项目 |
| `POST` | `/api/projects` `{ name }` | 创建；调用者成为 `owner` |
| `POST` | `/api/projects/:id/members` `{ username, role }` | 仅 owner |
| `POST` | `/api/projects/:id/wake` | 确保容器 healthy；返回 `{ status }` |
| `*` | `/api/projects/:id/agent/v1/...` | 成员；wake 后原样代理到 AgentHost `/v1/...`（含 SSE） |
| `GET` | `/api/projects/:id/agent/health` | 成员；代理 `/health` |

非成员 403。容器未就绪：`wake` 同步等到健康或超时 60 秒后 503。

Bearer 由控制面用现有 `signAgentHostToken` 签发，`exp` 为 10 分钟，每次代理请求新签。

## 容器

- 名字：`tah-project-<id>`
- 网络：不映射到公网；只映射到 `127.0.0.1` 的临时端口，或走 Docker 网络由控制面用容器 IP 访问。P0 选定：**不发布端口**，控制面通过 `docker inspect` 的容器 IP + 7800 访问（控制面与 Docker 在同一台机器）。
- 命令：`tah agent-host --cwd /workspace --host 0.0.0.0 --port 7800 --project-id <id> --yes`
- 环境：`AR_SHARED_SECRET`、`TAH_PROJECT_ID`、模型 key
- 空闲：最后一次代理后 30 分钟无请求则 `docker stop`（不 `rm`，以便下次 `start`）

## 测试

- store / auth：临时 SQLite，不碰真实数据目录。
- docker：注入假 runtime（记录 run/stop，假 health）。
- proxy：本地假 AgentHost（校验 Bearer 的 `projectId`），确认非成员 403、成员能把 `POST …/messages` 转到假服务。
- 不在 CI 里启动真 Docker。

## 实现顺序

1. store + 登录 + 项目成员（无 Docker）
2. 假 runtime 上的 wake / stop
3. Bearer 代理（含 SSE 透传）
4. 真 Docker runtime（手动验收，不进默认测试）
5. 文档 `docs/design/control-plane.md` 与 CHANGELOG（发版时）

## 风险

- 控制面和 Docker 必须在同一主机；多机要另做。
- `--yes` 会跳过审批；P0 靠 deny 写/执行工具，不能把生产目录挂进卷。
- 容器 IP 在 restart 后会变，每次 wake 重新 inspect。
