# 设计说明：内网控制面（P0）

状态：✅ 已实现（`v1.1` 开发分支，**尚未发版**）

## 背景

内网 SaaS 需要一层 **控制面（CP）**：用户登录、项目与成员、按项目拉起 `tah agent-host` 容器，并把浏览器请求转到对应 Agent。**浏览器只打控制面**；容器内的 AgentHost 只认 CP 签发的短时 Bearer。

`tah serve` 仍是本机工作台（cookie、静态页、Settings、预览等），**不改**。容器内 Agent 走 [AgentHost](/design/agent-host)；本机开发仍用 [tah serve](/design/serve)。

设计 spec：`docs/superpowers/specs/2026-10-18-control-plane-design.md`。

## 目标（P0）

- 私有包 **`apps/control`**（`@typescript-agent-harness/control`）：Node HTTP，默认只监听内网地址。
- **开发登录**：用户名 + 密码（SQLite `users` 表）；接口形状留给以后换公司 OIDC，P0 不接真实 SSO。
- **项目**：创建、列表、成员（`owner` / `member`）；非成员 403。
- **编排**：一项目一容器；首次 `wake` 或代理前 `docker run` / `docker start`；工作区卷 `<CONTROL_DATA>/projects/<id>/workspace`；空闲 **30 分钟** 无代理请求则 `docker stop`（不 `rm`，卷保留）。
- **代理**：`/api/projects/:id/agent/...` → 容器 `/health` 与 `/v1/*`，每次请求新签 **10 分钟** HMAC Bearer（`projectId`、`userId`、`exp`）。
- **审计**：谁、哪个项目、哪条路由、HTTP 状态码、时间；**不**记录消息正文。

## 非目标

- 公司 OIDC / LDAP、计费、配额 UI、K8s、控制面自带聊天 UI。
- 改 `tah serve` / TUI / AgentHost 路由语义。
- CI 里启动真 Docker（单测注入假 runtime）。

## 架构

```text
浏览器 → apps/control（HttpOnly cookie 会话）
            │  docker run / start / stop
            │  HTTP + 短时 Bearer
            ▼
         tah-project-<id>：tah agent-host --cwd /workspace --yes
            卷：<CONTROL_DATA>/projects/<id>/workspace
```

| 模块 | 职责 |
| --- | --- |
| `apps/control/src/auth.ts` | scrypt 密码、内存会话、`sid` cookie |
| `apps/control/src/store.ts` | 用户、项目、成员、审计（SQLite 单文件） |
| `apps/control/src/runtime.ts` | Docker 起停、`inspect` IP、健康轮询 |
| `apps/control/src/proxy.ts` | `signAgentHostToken`、转发含 SSE |
| `apps/control/src/http.ts` | 路由 |
| `apps/control/src/main.ts` | 环境变量、listen、空闲 sweep |

P0 **不发布**容器端口；控制面与 Docker 在同一主机，经 **`docker inspect` 容器 IP + 7800** 访问 AgentHost。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `AR_SHARED_SECRET` | 是 | — | 与每个 AgentHost 容器相同；缺则进程 exit 1 |
| `CONTROL_DATA` | 否 | `./.control-data` | 数据目录；SQLite 为 `<dir>/control.db`，项目卷在 `projects/<id>/workspace` |
| `CONTROL_IMAGE` | 否 | `tah-agent-host` | `docker run` 用的镜像 |
| `CONTROL_HOST` | 否 | `127.0.0.1` | 监听地址（生产应绑内网/VPN 可达地址） |
| `CONTROL_PORT` | 否 | `7810` | 监听端口 |
| `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` | 否 | — | 若设置，注入容器环境；**不进** API 响应 |

构建 AgentHost 镜像（手动，不进默认测试）：

```bash
docker build -f apps/control/Dockerfile -t tah-agent-host .
```

## 启动与用户

```bash
export AR_SHARED_SECRET='…'   # 与容器内一致
# 可选：DEEPSEEK_API_KEY / OPENAI_API_KEY、CONTROL_DATA、CONTROL_IMAGE

pnpm --filter @typescript-agent-harness/control build
node apps/control/dist/main.js
# 打印：control listening on http://127.0.0.1:7810
```

P0 **没有**自助注册 HTTP：用户行在 SQLite 里，需运维/bootstrap 写入（测试里用 `store.createUser` + `hashPassword`）。首次登录成功后 CP 下发 **`sid` HttpOnly cookie**（`SameSite=Lax`）。

## HTTP（给浏览器 / 公司前端）

除 `POST /api/login` 外都要有效会话 cookie。错误体一般为 `{ "error": string }`。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `POST` | `/api/login` `{ username, password }` | 成功设 cookie，200 `{ id, username }` |
| `POST` | `/api/logout` | 清 cookie，204 |
| `GET` | `/api/me` | 当前用户 |
| `GET` | `/api/projects` | 当前用户为成员的项目 |
| `POST` | `/api/projects` `{ name }` | 创建；调用者 `owner` |
| `POST` | `/api/projects/:id/members` `{ username, role }` | 仅 `owner`；`role` 为 `owner` \| `member` |
| `POST` | `/api/projects/:id/wake` | 成员；同步等到容器 healthy 或超时 |
| `GET` | `/api/projects/:id/agent/health` | 成员；代理 AgentHost `/health` |
| `*` | `/api/projects/:id/agent/v1/...` | 成员；wake 后原样代理 `/v1/...`（含 **SSE**） |

- 非成员：**403**。
- 容器在 **60s** 内未 healthy：`wake` 与代理路径 **503**。
- 代理路径上 CP 自动 wake、刷新空闲计时，并写审计行。

### 代理路径与 AgentHost 映射

浏览器调用：

```text
GET  /api/projects/<id>/agent/health
     → GET  http://<container-ip>:7800/health

POST /api/projects/<id>/agent/v1/sessions/<sid>/messages
     → POST http://<container-ip>:7800/v1/sessions/<sid>/messages
       Authorization: Bearer <CP 签发>
```

AgentHost 的 `/v1` 语义、SSE `HostEvent`、忙时 **409** 等见 [AgentHost 设计](/design/agent-host)。CP 应对**同一项目**串行化写请求（AgentHost 不排队）。

容器启动命令（由 runtime 注入）：`tah agent-host --cwd /workspace --host 0.0.0.0 --port 7800 --project-id <id> --yes`。P0 靠 **`--yes`** 与项目卷内 `tah.config.json` 的 `permissions.deny` 限制写/执行；CP 不提供审批 UI。

## 与 `tah serve` / `tah agent-host` 的边界

| | **`tah serve`** | **控制面 `apps/control`** | **`tah agent-host`（容器内）** |
| --- | --- | --- | --- |
| 谁用 | 开发者本机 | 公司内网前端 | 仅 CP 代理（Bearer） |
| 鉴权 | 启动令牌 → cookie | 用户名密码 → cookie | `AR_SHARED_SECRET` Bearer |
| Agent API | `/api/*`（hub、Settings、预览…） | `/api/projects/:id/agent/v1/*` | `/v1/*` |
| 编排 | 无 | Docker 一项目一容器 | 无 |
| 改不动 | — | 不得改变 serve 行为 | 由 CP 起停，不直接暴露公网 |

三者 **并行**：本机仍 `tah serve`；线上项目对话走 CP → 容器 AgentHost。

## 测试

```sh
pnpm --filter @typescript-agent-harness/control test
```

- store / auth / 登录与成员、wake、空闲 stop、503 超时
- proxy：假 AgentHost、Bearer、SSE 透传、403、审计
- runtime：`dockerRunArgs`（无 `-p`）、假 `exec` 的 ensure/stop
- **不**在 CI 调用真 `docker`

## 风险（运维）

- 控制面与 Docker 必须在同一主机；多机要另做。
- 容器 restart 后 IP 会变，每次 `ensure` 重新 inspect。
- `--yes` 跳过审批；勿把宿主机敏感目录挂进项目卷。
