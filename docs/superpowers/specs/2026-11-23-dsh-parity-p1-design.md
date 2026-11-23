# DSH 对照升级（P1）设计

状态：✅ 已实现（计划见 `docs/superpowers/plans/2026-11-23-dsh-parity-p1.md`；分支 `feat/dsh-parity-p1`）

在 P0（并行 worktree / 会话状态 / connectors token / MCP lazy）之上，对照 DeepSeek Harness 0.2.3 的下一批高价值工作流。**不**换 `packages/core`、**不**改 `DefaultLoop`、**不**引入 NestJS / Cordis。

前序：`docs/superpowers/specs/2026-11-22-dsh-parity-p0-design.md`（✅ + polish ✅）。

## 目标（P1）

1. **Code Review 绑定** — 会话可绑定一个 GitHub PR：看描述/文件列表/diff，页内与 agent 共审（对齐 DSH Code Review；GitLab 本迭代不做）。
2. **会话未读** — 非焦点会话在 turn 结束或 attention 时标未读；侧栏/快捷键可清（对齐 DSH unread；复用并行 attention 信号）。
3. **Connectors OAuth + 渠道扩容** — `authKind: "oauth"` 真流（至少一种：GitHub 或飞书 App）；钉钉 / 企微适配器挂上账号层（对齐 DSH 连接器生态的最小切片）。

## 非目标

- Timeline 任务树产品页（列 **P1.5**；可先在 Super-agent Ticket 上加摘要，不单独做树 UI）。
- 具名 AgentTeam 完整产品、跨会话发消息、Computer Use、远程 Web 登录、插件市场。
- GitLab MR、行注解扩展 API、Linear/Notion 等连接器插件包。
- 把 `reviewPanel` 工单侧栏与 Code Review 页强行合成一个插件墙。

## 原则

| 项 | 选择 |
| --- | --- |
| 框架 | 不动 core；旁路 + serve/web |
| Code Review | **默认 chat 可绑 PR**；Super-agent `createMockGitHubSource` / `reviewPanel` 作数据与人审种子，真 GitHub 用 connector OAuth 或 PAT |
| 未读 | 存在浏览器 `localStorage` + 可选服务端事件；不改 Session 持久化 schema（v1） |
| OAuth | 本机 `127.0.0.1` 回调；secret 进 connectors；UI 只见 hint / 已连接 |
| 钉钉/企微 | `packages/channels` 新适配器 + Settings Messaging 开关；密钥走 connectors |

## 依赖顺序

```text
P1-A  Code Review（mock / PAT 可读 PR → UI 绑会话）
        │
        ▼
P1-B  会话未读（可与 A 前半并行）
        │
        ▼
P1-C  Connectors OAuth（GitHub 优先，供 A 真源）
        │
        ▼
P1-D  钉钉 / 企微适配器（依赖 C 的账号模型，token 亦可先上）
```

建议落地：**B（小）→ A（mock）→ C（GitHub OAuth）→ A 接真源 → D**。

## A：Code Review 绑定

### 目标

- `POST /api/review/bind` `{ prUrl | owner/repo/number }` → 会话绑定 `ReviewBinding`。
- `GET /api/review` → 描述、状态、文件列表、可选 unified diff（截断上限）。
- 网页：右栏或「审阅」页签展示绑定；composer 旁「绑 PR…」；agent 仍走 DefaultLoop，system/notice 注入「当前绑定 PR #N」。
- Super-agent：可选把 ThreadId `github:pr/{n}` 与绑定对齐（不强制改 Router）。

### 数据

```ts
type ReviewBinding = {
  provider: "github";
  owner: string;
  repo: string;
  number: number;
  title?: string;
  url: string;
  boundAt: number;
};
```

v1 存在当前 workspace 的 serve 内存 + 可选 `.tah/review-binding.json`（按 cwd）。

### 源

| 阶段 | 源 |
| --- | --- |
| A1 | Fixture / `createMockGitHubSource` 形状扩展为可读 PR 快照 |
| A2 | GitHub REST + PAT（connectors `provider: "github"`, token） |
| A3 | GitHub OAuth（C 完成后替换 PAT 为 oauth 账号） |

### 非目标（A）

合并按钮写回、approve/request-changes 全套、行内评论同步、GitLab。

## B：会话未读

### 目标

- 非焦点 `workerId`（及侧栏 session，若易接）在 `turn.end` / `attention` 时标 `unread`。
- 切到该会话/worker → 清未读；菜单/快捷键可手动标未读。
- 侧栏/Workers 行显示未读点。

### 实现

- Web：`localStorage` key `tah.unread.<origin>` → `{ [workerId|sessionId]: true }`。
- 事件：现有 SSE `attention` / `workers` / `turn.end`（带 `workerId`）驱动。
- v1 **不**改 sqlite session 表。

### 非目标（B）

系统通知、声音、跨浏览器同步。

## C：Connectors OAuth

### 目标

- `ConnectorAccount.authKind` 扩展 `"oauth"`；存 refresh/access（加密或 0600 文件字段）、`expiresAt`。
- 本机启动：`GET /api/connectors/oauth/start?provider=github` → 浏览器授权 → `GET /api/connectors/oauth/callback` 写回 connectors。
- Settings：Connectors 区显示「用 GitHub 登录」/已连接 hint；可断开。

### 首发 provider

**GitHub**（服务 Code Review）。飞书 OAuth 可同协议加第二家，不阻塞。

### 非目标（C）

MCP OAuth 全自动刷新产品化（可后续复用 refresh 工具函数）；多租户 IdP。

## D：钉钉 / 企微

### 目标

- `packages/channels`：`dingtalk` / `wecom` 适配器（入站 → Super-agent 事件；出站 reply）。
- Settings Messaging 开关 + connectors token（或企业凭证字段）。
- `tah.channels.json` 启用位与现有 TG/Slack/飞书一致。

### 非目标（D）

人审按钮写回 IM、多应用多机器人租户。

## 验收（整包 P1）

- 可绑定 mock/真 GitHub PR，网页看到标题与文件列表，会话内 agent 知道绑定。
- 后台 worker 跑完或 attention 时，非焦点行有未读点；点入清除。
- GitHub OAuth（或 PAT 阶段）经 connectors 存密钥；UI 无明文。
- 钉钉或企微至少一条 mock/真链路能 ingest → reply（允许先 mock）。
- `DefaultLoop` / core 无行为变更。

## 与已有文档关系

| 文档 | 关系 |
| --- | --- |
| P0 design / polish | 底座；本文件不重复 |
| Super-agent design | `reviewPanel` / mock GitHub = A 种子 |
| channel-host design | D 扩展；钉钉企微原标 P1 |
| parallel-sessions | B 的 workerId / attention 输入 |

## P1.5 / 以后（仅占位）

Timeline 任务树、AgentTeam UX、GitLab、跨会话消息、Computer Use。
