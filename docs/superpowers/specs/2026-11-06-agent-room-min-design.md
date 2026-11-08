# 最小 Agent Room（群聊式多 Agent）设计草稿

状态：P0 已实现（`createRoom` + mock/`createSessionTurnRunner` + `demo-room.ts`；`test/room-session.test.ts` 覆盖消息序）。范围：协议 + 三回合；**不改 DefaultLoop / serve 默认交互**。  
对照：Accio「Agent 群聊 / TL 委派」叙事；tah 现状为 `run_subagent`（工具式委派）。

## 背景与目标

应用层常把「多 Agent」说成团队，但实现上只有两种常用形状：

1. **RPC 子 Agent**：父调 `run_subagent(task)`，拿回 `text`（tah 已有）。  
2. **群聊 Room**：共享 transcript、稳定角色、回合委派（Accio 产品叙事）。

本草案定义 **最小可演示的 Room**：能讲清「群线程 + TL + 成员」，且能落在 Runtime **旁路插件**，而不是塞进 LLM loop。

### 目标

- 3 个角色以内：`tl` + 1～2 个 `member`。  
- 共享消息列表可复盘（jsonl / 内存均可）。  
- TL 委派 → 成员跑一轮 → 结论贴回群 → TL 收口。  
- 人可插话（可选，demo 可脚本化）。

### 非目标（本稿不做）

- 嵌套群、跨房委派、插件市场。  
- 改 `DefaultLoop` / 替换 `run_subagent`。  
- 真 IM（钉钉/飞书）渠道（以后可把 Room 当后端）。  
- 强文件锁、成员级积分计费。  
- Parallel sessions / worktree（那是多任务并行，不是多角色群聊）。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| **Room** | 一间协作房间：成员表 + transcript + 调度状态 |
| **Member** | 稳定身份：`id`、人设、工具白名单、可选模型提示 |
| **TL** | 特殊成员 `id: "tl"`，负责拆任务与宣布完成 |
| **Message** | 群内一条发言（含系统事件） |
| **Turn** | 指定成员基于「其可见历史」跑一次 `Session.run` |

原则：**Session/Loop 仍只服务「一个说话者的一轮」**；Room 负责「谁该说话、大家看见什么」。

## 消息 Schema

```ts
type MemberId = "tl" | string; // 成员 id，如 "compliance" | "copy"

type MessageVisibility =
  | { mode: "all" }           // 全员可见（默认）
  | { mode: "tl_only" }       // 仅 TL + 用户（成员回合不可见）
  | { mode: "to"; ids: MemberId[] }; // 定向（进阶；MVP 可只用 all）

type RoomMessage = {
  id: string;                 // ulid / uuid
  at: string;                 // ISO time
  roomId: string;
  from: "user" | "system" | MemberId;
  /** 可选 @，调度提示；不强制改变可见性 */
  mention?: MemberId[];
  kind: "chat" | "delegate" | "result" | "status" | "error";
  text: string;
  visibility?: MessageVisibility; // 默认 { mode: "all" }
  /** 可选：本回合工具调用摘要，便于复盘 */
  traceHint?: { tools?: string[]; ok?: boolean };
};
```

### 可见性规则（MVP）

构建某成员本轮 prompt 时：

1. 取 transcript 中 `visibility.mode === "all"` 的消息；  
2. 加上 `from === 该成员` 的消息；  
3. 加上 `mode === "to"` 且 `ids` 含该成员的消息；  
4. **不含** 其他成员的 `tl_only` 私货（若有）。

用户消息一律 `all`。

### 落盘（建议）

```
out/rooms/<roomId>/transcript.jsonl   # 一行一条 RoomMessage
out/rooms/<roomId>/meta.json          # 成员表、状态、createdAt
```

与 selection-agent 的 `out/eval/*/trace.jsonl` 同思路：可复盘、可断言。

## Room 状态机（最小）

```ts
type RoomStatus =
  | "idle"          // 等人或等 TL
  | "tl_thinking"   // TL 回合进行中
  | "member_running"// 某成员回合进行中
  | "done"          // TL 已宣布交付
  | "failed";       // 不可恢复错误

type RoomMeta = {
  roomId: string;
  status: RoomStatus;
  activeMember?: MemberId;
  goal: string;                 // 用户初始目标
  members: RoomMember[];
};

type RoomMember = {
  id: MemberId;
  displayName: string;
  /** 注入该成员 Session 的系统人设 */
  persona: string;
  /** 工具名 allowlist；空 = 继承房间默认 */
  allowTools?: string[];
  /** 仅提示配置，真正选模仍走现有 host 配置 */
  modelHint?: string;
};
```

转换（demo 级）：

```
idle --user goal--> tl_thinking
tl_thinking --delegate @member--> member_running
member_running --result posted--> tl_thinking
tl_thinking --status: done--> done
* --error--> failed（或退回 tl_thinking 并贴 error 消息）
```

MVP **不做**多成员并行回合（避免锁与合并复杂度）；要并行仍用现有 research fan-out。

## 与现有 tah 的接缝

```
RoomPlugin / 应用脚本
    │  post(message)
    │  runTurn(memberId)
    ▼
SESSION.create() + session.run(prompt)
    │  工具 = 按成员 allowlist 过滤后的 ToolService 视图
    ▼  （可选）内部仍可调用 run_subagent
Room.transcript.append(result|error)
```

- **不修改** `subagentTool` 语义；Room 的 `runTurn` 是更高层 API。  
- 权限：成员 allowlist ∩ 全局 `permissions`；敏感工具仍走既有审批。  
- 评测：对 transcript 做顺序断言（类似 `assert-trace`），例如必须出现 `delegate` → `result` → `status:done`。

## 三回合 Demo 流程（可脚本化、可面试讲）

场景：**跨境上架前合规+文案快审**（与选品邻近，但不替代 research fan-out）。

### 角色

| id | 职责 |
| --- | --- |
| `tl` | 运营负责人：拆任务、综合结论 |
| `compliance` | 合规：看风险点，不编造认证 |
| `copy` | 文案：按合规结论改标题卖点（demo 可后置，第一版可只用 compliance） |

下面用 **TL + 1 成员** 保证「三回合」清晰；加 `copy` 则为五回合变体。

### 回合 1 — 用户开房，TL 接单

1. `createRoom({ goal, members: [tl, compliance] })`  
2. post `from:user, kind:chat`：  
   `目标：评估 ASIN B0XXX 上架德国站的合规风险，给出是否建议上架。`  
3. `runTurn("tl")`  
4. 期望 TL 产出 `kind:delegate`，`mention:["compliance"]`，例如：  
   `请核查该商品的认证/侵权风险，只基于工具返回，缺数据就写缺口。`

### 回合 2 — 成员执行

1. 调度器见 delegate → `status=member_running`, `activeMember=compliance`  
2. `runTurn("compliance")`：prompt = 可见历史 + persona  
3. 成员调工具（或 mock）后 post `kind:result`：  
   `风险：认证缺失（证据：…）；建议观察，不要直接上架。`  
4. 回到 `tl_thinking`

### 回合 3 — TL 收口

1. `runTurn("tl")`  
2. TL post `kind:status`，text 含约定标记，例如首行 `DONE`：  
   `DONE\n综合：合规建议观察；暂不上架。缺口：…`  
3. Room → `done`；对外交付 = 最后一条 status + 全文 transcript

### 成功标准（demo / eval）

- transcript 中顺序子序列：`user chat` → `tl delegate` → `compliance result` → `tl status(DONE)`  
- `compliance` 的 prompt **看不到** TL 的 `tl_only` 草稿（若测试里插过一条）  
- 全程无改 DefaultLoop；可用假 LLM / mock 工具跑通

## API 草图（实现时再落代码）

```ts
interface AgentRoom {
  readonly id: string;
  readonly meta: RoomMeta;
  transcript(): readonly RoomMessage[];
  post(msg: Omit<RoomMessage, "id" | "at" | "roomId">): RoomMessage;
  /** 跑指定成员一轮；内部 Session.run，把最终文本打成 result/chat */
  runTurn(memberId: MemberId): Promise<RoomMessage>;
  /** 便捷：按状态机自动推进到下一需要说话的角色（demo 调度） */
  step(): Promise<RoomMessage | null>;
}
```

应用层可先做 `scripts/demo-room.ts`，验证协议后再考虑 `tah serve` 群面板。

## 和 selection-agent / Accio 的边界

| | selection research | Agent Room |
| --- | --- | --- |
| 问题 | 多候选并行取证 | 多角色共议一个目标 |
| 上下文 | 候选隔离 | 共享群历史 |
| 现成手段 | `run_subagent` fan-out | 本草案 Room |
| Accio 对应 | 插件式工具任务 | 「Agent 群聊」 |

**不要**用 Room 重写选品 research；**不要**用 research 冒充群聊。

## 实现分期（有人真做时）

1. **P0**：内存 Room + jsonl + `demo-room.ts` 三回合（可 mock LLM）  
2. **P1**：房间级 eval（消息序断言）+ 简单 CLI 打印 transcript  
3. **P2**：serve UI 群面板（消息流、@、手动 `step`）  
4. **P3**：IM 渠道把外部消息 `post` 进 Room（仍不改 Loop）

## 面试一句话

> 群聊式多 Agent 的最小内核是 Room：共享消息、角色、回合；Session 仍只负责单说话者的工具循环。tah 已有 RPC 子 Agent；Room 是旁路编排，不是再造一个 Loop。

## 已定结论（原开放问题）

1. **TL 收口**：用结构化完成态，不用只靠文案前缀。  
   - `kind: "status"`，并带 `done: true`（实现时可放在 message 扩展字段或 meta 旁路写入）。  
   - `text` 仍给人读；调度 / eval 以 `done: true`（或 Room → `status: "done"`）为准，不解析「首行是否 DONE」。  
   - Demo 文案可继续写 `DONE\n…`，但不作为唯一信号。

2. **嵌套 `run_subagent`**：MVP **禁止**成员再调 `run_subagent`。  
   - 成员工具 allowlist 显式 deny（或房间默认不挂该工具）。  
   - 需要 fan-out 取证时，仍由应用层（如 selection research）自己做，不放进 Room 成员回合。

3. **用户插话**：MVP 仅允许在 `idle` 与 `tl_thinking` 插入。  
   - `member_running` 期间用户消息入队，等成员 `result` 回到 `tl_thinking` 后再 `post`。  
   - 不做打断/取消正在跑的成员回合（减少竞态与半截 transcript）。
