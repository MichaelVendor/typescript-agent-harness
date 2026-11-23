# DSH 对照升级（P0）设计

状态：📐 已设计（计划见 `docs/superpowers/plans/2026-11-22-dsh-parity-p0.md`）

对照 DeepSeek Harness ≤ **v0.2.3-alpha** 的工作流能力，按产品咬合度升级 tah；**不**换 `packages/core`、**不**改 `DefaultLoop`、**不**引入 NestJS / Cordis。

背景讨论结论：后端内核够用；缺口在编排与连接器。推荐顺序见下。

## 目标（P0）

1. **Worktree 并行会话** — 多路 Agent 真并行，文件隔离靠 git worktree（对齐 DSH Forge / Claude worktree）。
2. **会话状态面** — 当前 cwd / busy / 子 worker / 待审批 一眼可见（对齐 DSH session status；先做精简版）。
3. **连接器账号层** — IM / 未来 OAuth 的统一密钥与刷新入口（对齐 DSH connector accounts；P0 先抽象存储 + 迁移现有 Messaging tokens，OAuth 真授权可 P0.5）。
4. **MCP 工具按需暴露** — 减少每轮塞进 LLM 的 schema（对齐 DSH MCP on-demand）。

## 非目标

- 升级 / 替换 `packages/core` Runtime（保持「整 Runtime 重建」热更新）。
- Computer Use、远程 Web 登录、插件市场、GitLab 审评扩展、Office 技能包。
- 完整 Code Review 产品页、AgentTeam 产品、跨会话发消息（列 P1）。
- 钉钉 / 企微适配器实现（可挂在连接器账号层之后做 channel P1）。

## 原则

| 项 | 选择 |
| --- | --- |
| 框架 | 不动 `core`；应用层加子系统 |
| Worktree | **执行已有** `2026-10-28-parallel-sessions` 规格；仅补 DSH 对照增量 |
| 状态面 | 读编排器 + HostEvent；默认 chat 与 Super-agent 工单侧栏并存，不合并成一个巨型面板 |
| 连接器 | 新模块管「账号记录」；现有 `tah.channels.json` + Settings Messaging **迁入**，行为兼容 |
| MCP | 配置开关；默认保持今日「开机 listTools 全注册」；开启后延迟/裁剪暴露 |

## 依赖顺序

```text
A Worktree / parallel-sessions
        │
        ▼
B Session status（消费 A 的 worker 列表；无 A 时也可先做 main-only 状态）
        │
        ├──────────────► D MCP on-demand（可与 B/C 并行，无依赖）
        ▼
C Connector accounts（可与 A 并行起步；OAuth 真流放在 C 后半）
```

建议落地：**A → B → C（存储迁移）→ D**；C 的 OAuth 与钉钉/企微另开迭代。

## 与已有文档关系

| 文档 | 关系 |
| --- | --- |
| `docs/superpowers/specs/2026-10-28-parallel-sessions-design.md` | **A 的权威设计**；本文件只列对照增量 |
| `docs/superpowers/plans/2026-10-28-parallel-sessions.md` | **A 的实现计划**；本 P0 计划 Task 引用它 |
| `docs/superpowers/specs/2026-11-18-channel-host-design.md` | C 迁移源；P0 渠道集合不变 |
| Super-agent `reviewPanel` | P1 Code Review 的种子；本 P0 不扩 |

## A：Worktree — DSH 对照增量（相对 10-28 规格）

10-28 已覆盖：orchestrator、agent-worker、worktree 路径、`workerId`、attention、busy cap。

对照 DSH 0.2.2+ 额外约定（写入 A 验收，实现时并进 parallel-sessions 或小补丁）：

1. **延迟创建**：勾选「在 worktree 中新建」时，**首条用户消息发出前**再 `git worktree add`（避免空 worktree 垃圾）；取消草稿不留目录。
2. **状态钩子**：orchestrator 暴露只读快照（worker 列表、cwd、busy、pending approval），供 B 消费。
3. **文档**：`.gitignore` 建议条目 `.tah/worktrees/`。

## B：会话状态面

### 目标

`tah serve` 右侧（或窄窗底部停靠）一块只读 **Session status**：

| 区块 | 数据来源 |
| --- | --- |
| Working directory | 焦点 worker 的 cwd |
| Turn | busy / idle；待 `approval` / `question` |
| Workers | orchestrator 列表（A 未落地时仅 `main`） |
| Super-agent | 若 `--super-agent`：工单数摘要（链到现有工单侧栏，不复制整表） |

### 非目标

可拖分区插件墙、插件启停、Timeline 任务树、未读会话（P1）。

### API

- `GET /api/session-status` → JSON 快照（焦点 `workerId` + 上表字段）。
- 可选：SSE 已有事件足够驱动 UI 时，快照仅作首屏；busy/approval 仍跟 HostEvent。

## C：连接器账号层

### 目标

- 类型：`ConnectorAccount`（id、provider、`keyHint`、密文存 `~/.tah/connectors.json` mode 0600，或并入 settings 的 `connectors` 键）。
- Settings / Messaging **读写改走账号层**；`tah.channels.json` 仍只存「启用哪些渠道 + 非密钥字段」（如 `mirrorChatId`）。
- 预留 `authKind: "token" | "oauth"`；P0 只实现 `token`。

### 非目标（本迭代）

OAuth 浏览器跳转、MCP OAuth、Linear/Notion 等 DSH 连接器插件。

## D：MCP 按需暴露

### 目标

- `tah.config.json` / settings 增加 `mcp.toolExposure: "eager" | "lazy"`（默认 `eager`）。
- `lazy`：`setup` 不把全部 MCP tool schema 注册进给 LLM 的列表；提供：
  - 一条 `list_mcp_tools`（或按 server 分组的发现工具），以及
  - 按名启用后才 `tools.register` 进本会话可用集；或
  - 更简：仅把 schema 留到首次 `tools/list` 调用时再挂（实现选更小的一种，计划里写死）。

### 非目标

改 MCP SDK 传输；按工具名的 ACL UI。

## 验收（整包 P0）

- 同一 git 仓库可开 ≥2 个 worktree worker 并行跑轮次，互不写主 checkout。
- 状态面显示焦点 cwd + busy +（有 A 时）worker 列表。
- Messaging 密钥经账号层读写，旧配置可迁移或双读兼容一版。
- `lazy` 模式下，未启用的 MCP 工具名不出现在首轮 LLM tools 数组里。
- `DefaultLoop` / `packages/core` 无行为变更；回归 `pnpm test` 相关包通过。

## P1（另文）

见 [`2026-11-23-dsh-parity-p1-design.md`](./2026-11-23-dsh-parity-p1-design.md)（Code Review 绑定、未读、OAuth、钉钉/企微）。Timeline / AgentTeam 等为 P1.5。
